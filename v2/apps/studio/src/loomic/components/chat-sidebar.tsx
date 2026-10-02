"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useBreakpoint } from "../hooks/use-breakpoint";
import type {
  ContentBlock,
  ImageArtifact,
  ImageGenerationPreference,
  MessageMention,
  StreamEvent,
  VideoArtifact,
  VideoGenerationPreference,
} from "@loomic/shared";
import { useAgentModel } from "../hooks/use-agent-model";
import { mapServerMessages, useChatSessions } from "../hooks/use-chat-sessions";
import { useChatStream } from "../hooks/use-chat-stream";
import {
  INITIAL_AGENT_MODEL_KEY,
  INITIAL_ATTACHMENTS_KEY,
  INITIAL_IMAGE_GENERATION_PREFERENCE_KEY,
} from "../hooks/use-create-project";
import type { ReadyAttachment } from "../hooks/use-image-attachments";
import { useImageAttachments } from "../hooks/use-image-attachments";
import { useImageModelPreference } from "../hooks/use-image-model-preference";
import { useVideoModelPreference } from "../hooks/use-video-model-preference";
import type { WebSocketHandle } from "../hooks/use-websocket";
import { fetchImageModels, fetchWorkspaceSkills, replaceMessages } from "../lib/server-api";
import type { CanvasSelectedElement } from "./canvas-editor";
import {
  type BrandKitMentionItem,
  type CanvasImageItem,
  type ImageModelMentionItem,
  type SkillMentionItem,
  MessageMentionPicker,
  type MessageMentionPickerItem,
} from "./canvas-image-picker";
import { BalanceConsent, useBalanceConsent } from "../../BalanceConsent";
import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { ChatSkills } from "./chat-skills";
import { useToast } from "./toast";
import { ErrorBoundary } from "./error-boundary";
import { SessionSelector } from "./session-selector";
import { getIdentityEpoch } from "../../api";
import { assistantIdForRun, receivedImageTools, recoveredContentBlocks, runIdFromAssistant } from "../lib/request-recovery";

type ChatSidebarProps = {
  accessToken: string;
  canvasId: string;
  open: boolean;
  onToggle: () => void;
  onImageGenerated?: (artifact: ImageArtifact) => void;
  onVideoGenerated?: (artifact: VideoArtifact) => void;
  onCanvasSync?: () => void;
  /** Called for every stream event — used by job fallback polling to detect timed-out jobs */
  onStreamEvent?: (event: StreamEvent) => void;
  initialPrompt?: string | undefined;
  initialSessionId?: string | undefined;
  onSessionChange?: (sessionId: string) => void;
  onRequestCanvasImages?: () => CanvasImageItem[];
  currentBrandKitId?: string | null;
  ws: WebSocketHandle;
  selectedCanvasElements?: CanvasSelectedElement[];
};

export function ChatSidebar({
  accessToken,
  canvasId,
  open,
  onToggle,
  onImageGenerated,
  onVideoGenerated,
  onCanvasSync,
  onStreamEvent,
  initialPrompt,
  initialSessionId,
  onSessionChange,
  onRequestCanvasImages,
  currentBrandKitId,
  ws,
  selectedCanvasElements,
}: ChatSidebarProps) {
  const breakpoint = useBreakpoint();
  const isOverlay = breakpoint !== "desktop";

  // ── Session & message management (extracted hook with LRU cache) ──
  const {
    sessions,
    activeSessionId,
    activeSessionIdRef,
    messages,
    messagesRef,
    snapshotMessages,
    setMessages,
    sessionsLoading,
    messagesLoading,
    streaming,
    setStreaming,
    updateSessionMessages,
    handleSelectSession,
    handleNewChat,
    handleDeleteSession,
    autoTitleSession,
    reloadMessages,
    accessTokenRef,
    messageIdentityRef,
  } = useChatSessions({
    canvasId,
    accessToken,
    initialSessionId,
    onSessionChange,
  });

  const balanceConsent = useBalanceConsent(accessToken + ":" + activeSessionId);

  // ── Stream event handler (extracted hook, shared between send & reconnect) ──
  const { applyStreamEvent } = useChatStream(updateSessionMessages);

  // ── Mention & attachment state ──
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [messageMentions, setMessageMentions] = useState<MessageMention[]>([]);
  const [brandKitMentionItems, setBrandKitMentionItems] = useState<
    BrandKitMentionItem[]
  >([]);
  const [imageModelMentionItems, setImageModelMentionItems] = useState<
    ImageModelMentionItem[]
  >([]);
  const [skillMentionItems, setSkillMentionItems] = useState<
    SkillMentionItem[]
  >([]);
  const [creditDialog, setCreditDialog] = useState<{
    open: boolean;
    currentBalance: number;
    requiredAmount: number;
    plan: string;
    dailyClaimed: boolean;
  } | null>(null);
  const chatInputRef = useRef<import("./chat-input").ChatInputHandle>(null);

  const initialPromptSent = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const sendPending = useRef(false);
  const alive = useRef(false);
  const activeRunId = useRef<string | null>(null)
  const disposeRun = useRef<(() => void) | null>(null)
  const { toast: showToast } = useToast();
  const recoveryBindings = useRef(new Map<string, { owner: string; epoch: number; assistantId: string; sessionId: string; insertedTools: Set<string>; finish: (notSubmitted?: boolean) => void }>())
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abortRef.current = true; disposeRun.current?.() }
  }, [])
  useEffect(() => ws.onRecovery((state, result) => {
    const binding = recoveryBindings.current.get(state.runId)
    if (!alive.current || !binding || binding.owner !== accessTokenRef.current || binding.epoch !== getIdentityEpoch()) return
    if (state.status === 'not_submitted') updateSessionMessages(binding.sessionId, previous => previous.map(message => message.id === binding.assistantId
      ? { ...message, id: `assistant-unsent-${state.runId}`, contentBlocks: [...message.contentBlocks, { type: 'text', text: state.message }] } : message))
    if (state.status !== 'receiving') binding.finish(state.status === 'not_submitted')
    if (result?.status !== 'completed' || !result.result || !('events' in result.result)) return
    if (!snapshotMessages(binding.sessionId).some(message => message.id === binding.assistantId)) return
    updateSessionMessages(binding.sessionId, previous => previous.map(message => message.id === binding.assistantId
      ? { ...message, contentBlocks: recoveredContentBlocks(result.result && 'events' in result.result ? result.result.events : [], message.contentBlocks) }
      : message))
    void replaceMessages(binding.owner, binding.sessionId, snapshotMessages(binding.sessionId)).catch(error => showToast(error instanceof Error ? error.message : '恢复内容本地保存失败', 'error'))
    for (const event of result.result.events) {
      if (event.type !== 'tool.completed' || binding.insertedTools.has(event.toolCallId)) continue
      binding.insertedTools.add(event.toolCallId)
      for (const artifact of event.artifacts ?? []) if (artifact.type === 'image') onImageGenerated?.(artifact)
    }
  }), [ws.onRecovery, accessTokenRef, snapshotMessages, updateSessionMessages, showToast, onImageGenerated])
  useEffect(() => {
    if (sessionsLoading || messagesLoading || !activeSessionId || streaming) return
    const owner = accessTokenRef.current, epoch = getIdentityEpoch()
    if (messageIdentityRef.current?.owner !== owner || messageIdentityRef.current.epoch !== epoch) return
    const restored: string[] = []
    for (const message of messages) {
      const runId = runIdFromAssistant(message)
      if (!runId) continue
      const binding = recoveryBindings.current.get(runId)
      if (binding?.owner === owner && binding.epoch === epoch && binding.sessionId === activeSessionId && binding.assistantId === message.id) continue
      // Previously received artifacts stay downloadable. Reading again never
      // recreates an image the user deleted, or retries a failed canvas insert.
      recoveryBindings.current.set(runId, { owner, epoch, assistantId: message.id, sessionId: activeSessionId, insertedTools: receivedImageTools(message.contentBlocks), finish: () => {} })
      ws.restoreRun(runId, activeSessionId)
      restored.push(runId)
    }
    // One automatic read for the visible session's latest saved request;
    // older original requests remain available through their manual controls.
    const latest = restored.at(-1)
    if (latest && navigator.onLine) void ws.recoverRun(latest)
  }, [messages, sessionsLoading, messagesLoading, streaming, activeSessionId, accessTokenRef, messageIdentityRef, ws.restoreRun, ws.recoverRun])
  const messageMentionsRef = useRef(messageMentions);
  messageMentionsRef.current = messageMentions;
  const selectedCanvasElementsRef = useRef(selectedCanvasElements);
  selectedCanvasElementsRef.current = selectedCanvasElements;
  const prevConnectedRef = useRef(false);

  const {
    attachments: imageAttachments,
    addFiles,
    addCanvasRef,
    retryUpload,
    removeAttachment,
    clearAll: clearAttachments,
    isUploading,
    readyAttachments,
  } = useImageAttachments(accessToken);

  const { activeImageGenerationPreference } = useImageModelPreference();
  const activeImageGenerationPreferenceRef = useRef(
    activeImageGenerationPreference,
  );
  activeImageGenerationPreferenceRef.current = activeImageGenerationPreference;

  const { activeVideoGenerationPreference } = useVideoModelPreference();
  const activeVideoGenerationPreferenceRef = useRef(
    activeVideoGenerationPreference,
  );
  activeVideoGenerationPreferenceRef.current = activeVideoGenerationPreference;

  const { model: agentModel } = useAgentModel();
  const agentModelRef = useRef(agentModel);
  agentModelRef.current = agentModel;

  // ── Sidebar resize ──
  const SIDEBAR_MIN = 300;
  const SIDEBAR_MAX = 600;
  const CANVAS_MIN = 320;
  const SIDEBAR_KEYBOARD_STEP = 20;
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [sidebarMax, setSidebarMax] = useState(SIDEBAR_MAX);
  const desktopPanel = useRef<HTMLDivElement>(null);
  const widthLimit = useRef(SIDEBAR_MAX);
  const isResizing = useRef(false);

  const clampWidth = useCallback(
    (w: number) => Math.min(widthLimit.current, Math.max(Math.min(SIDEBAR_MIN, widthLimit.current), w)),
    [],
  );

  useLayoutEffect(() => {
    const workspace = desktopPanel.current?.parentElement;
    if (!open || isOverlay || !workspace) return;
    const fitWorkspace = () => {
      const maximum = Math.min(SIDEBAR_MAX, Math.max(0, Math.floor(workspace.getBoundingClientRect().width) - CANVAS_MIN));
      widthLimit.current = maximum;
      setSidebarMax(maximum);
      setSidebarWidth(clampWidth);
    };
    fitWorkspace();
    const observer = new ResizeObserver(fitWorkspace);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [open, isOverlay, clampWidth]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = startX - moveEvent.clientX;
        setSidebarWidth(clampWidth(startWidth + delta));
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [sidebarWidth, clampWidth],
  );

  // Touch support for resize handle (mobile / tablet)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      isResizing.current = true;
      const startX = touch.clientX;
      const startWidth = sidebarWidth;

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (!isResizing.current) return;
        const t = moveEvent.touches[0];
        if (!t) return;
        moveEvent.preventDefault(); // prevent scroll during resize
        const delta = startX - t.clientX;
        setSidebarWidth(clampWidth(startWidth + delta));
      };

      const handleTouchEnd = () => {
        isResizing.current = false;
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
        document.removeEventListener("touchcancel", handleTouchEnd);
      };

      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleTouchEnd);
      document.addEventListener("touchcancel", handleTouchEnd);
    },
    [sidebarWidth, clampWidth],
  );

  // Keyboard support for resize handle (ArrowLeft/ArrowRight)
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSidebarWidth((prev) => clampWidth(prev + SIDEBAR_KEYBOARD_STEP));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSidebarWidth((prev) => clampWidth(prev - SIDEBAR_KEYBOARD_STEP));
      }
    },
    [clampWidth],
  );

  // ── Auto-scroll to bottom ──
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Fetch image models for @mention picker ──
  useEffect(() => {
    let cancelled = false;

    fetchImageModels()
      .then((data) => {
        if (cancelled) return;
        setImageModelMentionItems(
          data.models.map((model) => ({
            kind: "image-model",
            id: model.id,
            label: model.displayName,
            description: model.description,
            ...(model.iconUrl ? { iconUrl: model.iconUrl } : {}),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setImageModelMentionItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch enabled workspace skills for @ mention
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    fetchWorkspaceSkills(accessToken)
      .then((data) => {
        if (cancelled) return;
        const allSkills = data.skills ?? [];
        const enabledSkills = allSkills.filter((s) => s.enabled);
        console.log(`[chat-sidebar] Workspace skills loaded: ${allSkills.length} total, ${enabledSkills.length} enabled`);
        setSkillMentionItems(
          enabledSkills.map((s) => ({
            kind: "skill" as const,
            id: s.id,
            label: s.name,
            slug: s.slug,
            description: s.description,
          })),
        );
      })
      .catch((err) => {
        console.error("[chat-sidebar] Failed to load workspace skills:", err);
        if (!cancelled) setSkillMentionItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // ── Send message ──
  const handleSend = useCallback(
    async (
      text: string,
      attachmentsOverride?: ReadyAttachment[],
      imageGenerationPreferenceOverride?: ImageGenerationPreference,
      mentionsOverride?: MessageMention[],
    ) => {
      const currentSessionId = activeSessionIdRef.current;
      if (sendPending.current || streaming || !currentSessionId) return;
      if (messageIdentityRef.current?.owner !== accessTokenRef.current || messageIdentityRef.current.epoch !== getIdentityEpoch()) return;
      sendPending.current = true;
      const payWithBalance = balanceConsent.consume();

      // Merge explicitly-attached images with auto-sensed canvas selection images
      let currentAttachments = attachmentsOverride ?? readyAttachments;
      const selectedEls = selectedCanvasElementsRef.current ?? [];
      const selectedImageEls = selectedEls.filter(
        (el) =>
          el.type === "image" && el.fileId && (el.storageUrl || el.dataUrl),
      );
      if (selectedImageEls.length > 0 && !attachmentsOverride) {
        const existingIds = new Set(currentAttachments.map((a) => a.assetId));
        const selectionAttachments: ReadyAttachment[] = selectedImageEls
          .filter((el) => !existingIds.has(el.id))
          .map((el) => ({
            assetId: el.id,
            url: el.storageUrl ?? el.dataUrl!,
            mimeType: "image/png",
            source: "canvas-ref" as const,
            name: `Canvas selection ${el.id.slice(0, 6)}`,
          }));
        if (selectionAttachments.length > 0) {
          currentAttachments = [...currentAttachments, ...selectionAttachments];
        }
      }
      const currentImageGenerationPreference =
        imageGenerationPreferenceOverride ??
        activeImageGenerationPreferenceRef.current;
      const currentVideoGenerationPreference =
        activeVideoGenerationPreferenceRef.current;
      const currentMentions = mentionsOverride ?? messageMentionsRef.current;

      // Add user message locally
      const imageBlocks: ContentBlock[] = currentAttachments.map((a) => ({
        type: "image" as const,
        assetId: a.assetId,
        url: a.url,
        mimeType: a.mimeType,
        source: a.source,
        ...(a.name ? { name: a.name } : {}),
      }));
      const mentionBlocks: ContentBlock[] = currentMentions.map((mention) =>
        mention.mentionType === "image-model"
          ? {
              type: "mention" as const,
              mentionType: "image-model" as const,
              id: mention.id,
              label: mention.label,
            }
          : mention.mentionType === 'skill' ? {
              type: 'mention' as const, mentionType: 'skill' as const,
              id: mention.id, label: mention.label, slug: mention.slug,
            } : {
              type: "mention" as const,
              mentionType: "brand-kit-asset" as const,
              id: mention.id,
              label: mention.label,
              assetType: mention.assetType,
              ...(mention.textContent !== undefined
                ? { textContent: mention.textContent }
                : {}),
              ...(mention.fileUrl !== undefined
                ? { fileUrl: mention.fileUrl }
                : {}),
            },
      );
      const userMsg = {
        id: `user-${Date.now()}`,
        role: "user" as const,
        contentBlocks: [
          { type: "text" as const, text },
          ...mentionBlocks,
          ...imageBlocks,
        ],
      };
      // Create assistant placeholder
      const originalRunId = crypto.randomUUID();
      const assistantId = assistantIdForRun(originalRunId);
      const previousMessages = snapshotMessages(currentSessionId);
      updateSessionMessages(currentSessionId, (prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant" as const, contentBlocks: [] },
      ]);
      setStreaming(true);
      abortRef.current = false;

      const runOwner = accessTokenRef.current
      const runEpoch = getIdentityEpoch()
      const insertedTools = new Set<string>()
      recoveryBindings.current.set(originalRunId, { owner: runOwner, epoch: runEpoch, assistantId, sessionId: currentSessionId, insertedTools, finish: () => {} })
      const sameOwner = () => alive.current && runOwner === accessTokenRef.current && runEpoch === getIdentityEpoch()
      let prepared = false
      let started = false
      let finished = false
      let saveTimer: ReturnType<typeof setTimeout> | undefined
      let saving = Promise.resolve()
      const persist = () => {
        clearTimeout(saveTimer)
        saveTimer = undefined
        if (!prepared || !sameOwner()) return
        const snapshot = snapshotMessages(currentSessionId).map(message => !finished && message.id === assistantId
          ? { ...message, contentBlocks: [...message.contentBlocks, { type: 'text' as const, text: '接收尚未完成，结果和费用待确认；请检查 New API 记录，不要重复提交。' }] }
          : message)
        saving = saving.then(() => replaceMessages(runOwner, currentSessionId, snapshot)).catch(error => showToast(error instanceof Error ? error.message : '本地对话保存失败', 'error'))
      }
      try {
        // No model POST until the original request ID and both message rows
        // have committed to the existing owner-scoped IndexedDB draft.
        await replaceMessages(runOwner, currentSessionId, snapshotMessages(currentSessionId))
        prepared = true
        if (!sameOwner() || abortRef.current || activeSessionIdRef.current !== currentSessionId) throw new Error('原请求未发送；账号、会话或接收状态已变化')
        autoTitleSession(text)
        const perf = {
          t0Send: performance.now(),
          tAck: 0,
          tFirstToken: 0,
          gotFirstToken: false,
        };

        let resolveStream: () => void;
        const streamDone = new Promise<void>((r) => {
          resolveStream = r;
        });
        const runIdRef = { current: "" };

        const cleanup = ws.onEvent((event) => {
          if (!sameOwner()) { resolveStream(); return }
          if (!runIdRef.current || event.runId !== runIdRef.current) return;
          if (abortRef.current) {
            resolveStream();
            return;
          }

          // Track first token timing
          if (!perf.gotFirstToken && event.type === "message.delta") {
            perf.tFirstToken = performance.now();
            perf.gotFirstToken = true;
            console.log(
              `[perf] send → first token: ${(perf.tFirstToken - perf.t0Send).toFixed(0)}ms` +
                ` (ack→token: ${(perf.tFirstToken - perf.tAck).toFixed(0)}ms)`,
            );
          }

          // Apply event to messages (single source of truth — shared with reconnect)
          applyStreamEvent(event, assistantId, currentSessionId);
          finished = ['run.completed', 'run.failed', 'run.canceled'].includes(event.type)
          if (finished) persist()
          else if (!saveTimer) saveTimer = setTimeout(persist, 100)

          // Forward event to parent for fallback job polling (timed-out generation recovery)
          onStreamEvent?.(event);

          // Fire canvas insertion callbacks for image/video artifacts.
          // Skip if the backend already inserted the element (elementId in output).
          const backendInserted = event.type === "tool.completed"
            && event.output
            && typeof (event.output as Record<string, unknown>).elementId === "string";
          if (
            event.type === "tool.completed" &&
            event.artifacts &&
            event.toolName !== "screenshot_canvas" &&
            !backendInserted &&
            !insertedTools.has(event.toolCallId)
          ) {
            insertedTools.add(event.toolCallId)
            for (const artifact of event.artifacts) {
              if (artifact.type === "image" && onImageGenerated) {
                onImageGenerated(artifact as ImageArtifact);
              }
              if (artifact.type === "video" && onVideoGenerated) {
                onVideoGenerated(artifact as VideoArtifact);
              }
            }
          }

          if (event.type === "canvas.sync" && onCanvasSync) {
            onCanvasSync();
          }

          // Preview model hint: suggest switching when run fails
          if (event.type === "run.failed") {
            const currentModel = agentModelRef.current ?? "";
            if (currentModel.includes("preview")) {
              showToast(
                "当前 Preview 模型请求不稳定，建议切换模型后重试",
                "error",
              );
            }
          }

          if (
            event.type === "run.completed" ||
            event.type === "run.failed" ||
            event.type === "run.canceled"
          ) {
            resolveStream();
          }
        });

        disposeRun.current = () => {
          persist()
          if (activeRunId.current) ws.cancelRun(activeRunId.current)
          cleanup()
          resolveStream()
        }
        // 通过认证 SSE 传输启动，不自动重试写入。
        const runId = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("请求确认超时，请检查服务状态"));
          }, 10_000);

          ws.startRun(
            {
              sessionId: currentSessionId,
              conversationId: canvasId,
              prompt: text,
              ...(payWithBalance ? { payWithBalance: true } : {}),
              canvasId,
              accessToken: accessTokenRef.current,
              ...(currentAttachments.length > 0
                ? { attachments: currentAttachments }
                : {}),
              ...(currentMentions.length > 0
                ? { mentions: currentMentions }
                : {}),
              ...(currentImageGenerationPreference
                ? {
                    imageGenerationPreference: currentImageGenerationPreference,
                  }
                : {}),
              ...(currentVideoGenerationPreference
                ? {
                    videoGenerationPreference: currentVideoGenerationPreference,
                  }
                : {}),
              ...(agentModelRef.current
                ? { model: agentModelRef.current }
                : {}),
            },
            (ack) => {
              clearTimeout(timeout);
              perf.tAck = performance.now();
              console.log(
                `[perf] send → ack: ${(perf.tAck - perf.t0Send).toFixed(0)}ms`,
              );
              const id = ack.payload.runId as string;
              started = true
              runIdRef.current = id;
              activeRunId.current = id
              recoveryBindings.current.set(id, { owner: runOwner, epoch: runEpoch, assistantId, sessionId: currentSessionId, insertedTools, finish: notSubmitted => { if (notSubmitted) finished = true; resolveStream() } })
              resolve(id);
            },
            originalRunId,
          );
        });
        clearAttachments();
        setMessageMentions([]);

        await streamDone;
        cleanup();
        if (activeRunId.current === runId) activeRunId.current = null
      } catch (error) {
        if (!sameOwner()) return
        if (!prepared) {
          updateSessionMessages(currentSessionId, () => previousMessages)
          if (activeSessionIdRef.current === currentSessionId) chatInputRef.current?.restoreDraft(text)
          showToast(`本地对话保存失败，原请求未发送。${error instanceof Error ? error.message : ''}`, 'error')
          return
        }
        finished = true
        updateSessionMessages(currentSessionId, (prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const hasText = m.contentBlocks.some((b) => b.type === "text");
            if (hasText) return m;
            return {
              ...m,
              ...(!started ? { id: `assistant-unsent-${originalRunId}` } : {}),
              contentBlocks: [
                ...m.contentBlocks,
                { type: "text" as const, text: error instanceof Error ? error.message : "请求失败，请检查模型配置或登录状态。" },
              ],
            };
          }),
        );
      } finally {
        persist()
        await saving
        disposeRun.current = null
        sendPending.current = false
        if (sameOwner()) setStreaming(false);
      }
    },
    [
      streaming,
      balanceConsent.consume,
      canvasId,
      applyStreamEvent,
      updateSessionMessages,
      onImageGenerated,
      onVideoGenerated,
      onCanvasSync,
      onStreamEvent,
      readyAttachments,
      clearAttachments,
      ws,
      autoTitleSession,
      accessTokenRef,
      activeSessionIdRef,
    ],
  );

  // ── Mention picker ──
  const mentionPickerItems: MessageMentionPickerItem[] = [
    ...(onRequestCanvasImages ? onRequestCanvasImages() : []),
    ...brandKitMentionItems,
    ...imageModelMentionItems,
    ...skillMentionItems,
  ];

  const handleMentionSelect = useCallback(
    (item: MessageMentionPickerItem) => {
      if (item.kind === "canvas-image") {
        addCanvasRef({
          assetId: item.assetId,
          url: item.url,
          mimeType: item.mimeType,
          name: item.name,
        });
        return;
      }

      setMessageMentions((prev) => {
        let nextMention: MessageMention;
        if (item.kind === "image-model") {
          nextMention = { mentionType: "image-model", id: item.id, label: item.label };
        } else if (item.kind === "skill") {
          nextMention = { mentionType: "skill", id: item.id, label: item.label, slug: item.slug };
        } else {
          nextMention = {
            mentionType: "brand-kit-asset",
            id: item.id,
            label: item.label,
            assetType: item.assetType,
            ...(item.textContent !== undefined
              ? { textContent: item.textContent }
              : {}),
            ...(item.fileUrl !== undefined
              ? { fileUrl: item.fileUrl }
              : {}),
          };
        }

        if (
          prev.some(
            (m) =>
              m.mentionType === nextMention.mentionType &&
              m.id === nextMention.id,
          )
        ) {
          return prev;
        }
        return [...prev, nextMention];
      });
    },
    [addCanvasRef],
  );

  const handleRemoveMention = useCallback((mention: MessageMention) => {
    setMessageMentions((prev) =>
      prev.filter(
        (item) =>
          !(item.mentionType === mention.mentionType && item.id === mention.id),
      ),
    );
  }, []);

  // ── Collapsed state ──
  if (!open) {
    return (
      <div className="absolute right-3 top-3 z-20">
        <button
          onClick={onToggle}
          type="button"
          className="group inline-flex items-center gap-1 rounded-xl bg-card/80 backdrop-blur-sm border border-border px-2.5 py-1.5 text-xs text-foreground/60 shadow-sm hover:bg-card hover:text-foreground transition-colors cursor-pointer md:px-2.5 md:py-1.5 min-h-[36px] md:min-h-0"
        >
          <svg className="size-4 md:size-3.5" viewBox="0 0 24 24" fill="none">
            <path
              fill="currentColor"
              fillOpacity={0.9}
              d="M18.25 3c2.071 0 3.946 2.16 3.946 4.23L22 15.75a3.75 3.75 0 0 1-3.75 3.75h-2.874a.25.25 0 0 0-.16.058l-2.098 1.738a1.75 1.75 0 0 1-2.24-.007l-2.065-1.73a.25.25 0 0 0-.162-.059H5.75A3.75 3.75 0 0 1 2 15.75v-9A3.75 3.75 0 0 1 5.75 3zM7.5 10q-.053 0-.104.005a1.25 1.25 0 0 0-1.14 1.117l-.006.128.007.128a1.25 1.25 0 1 0 1.37-1.371l-.02-.002A1 1 0 0 0 7.5 10m4.5 0q-.053 0-.104.005a1.25 1.25 0 0 0-1.14 1.117l-.006.128.007.128a1.25 1.25 0 1 0 1.37-1.371l-.02-.002A1 1 0 0 0 12 10m4.5 0q-.053 0-.105.005a1.25 1.25 0 0 0-1.138 1.117l-.007.128.007.128a1.25 1.25 0 1 0 1.37-1.371l-.02-.002A1 1 0 0 0 16.5 10"
            />
          </svg>
          对话
        </button>
      </div>
    );
  }

  // Shared event isolation — prevent keyboard/clipboard events from bleeding
  // into Excalidraw canvas when the sidebar has focus.
  const eventIsolationProps = {
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
    onKeyUp: (e: React.KeyboardEvent) => e.stopPropagation(),
    onCopy: (e: React.ClipboardEvent) => e.stopPropagation(),
    onCut: (e: React.ClipboardEvent) => e.stopPropagation(),
    onPaste: (e: React.ClipboardEvent) => e.stopPropagation(),
    onWheel: (e: React.WheelEvent) => e.stopPropagation(),
  };

  // The inner panel content is shared across all breakpoints.
  // Extracted as a variable to avoid duplicating the chat UI tree
  // between overlay (mobile/tablet) and inline (desktop) render paths.
  const panelContent = (
    <>
      {/* Header */}
      <div className="flex min-h-[48px] items-center justify-between pl-4 pr-2">
        <div className="flex items-center gap-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground shrink-0">
            创作助手
          </h2>
          {!sessionsLoading && (
            <SessionSelector
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={handleSelectSession}
              onNewChat={handleNewChat}
              onDelete={handleDeleteSession}
            />
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          title="收起创作助手"
          aria-label="收起创作助手"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 3.25a.75.75 0 0 1 .75.75v16a.75.75 0 0 1-1.5 0V4A.75.75 0 0 1 4 3.25m9.47 2.22a.75.75 0 0 1 1.06 0l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 1 1-1.06-1.06l4.72-4.72H8a.75.75 0 0 1 0-1.5h10.19l-4.72-4.72a.75.75 0 0 1 0-1.06"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      {/* Disconnected banner */}
      {!ws.connected && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted border-b border-border">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-[pulse_1.2s_ease-in-out_infinite]" />
          <span className="text-[11px] text-muted-foreground">
            创作服务暂不可用，请检查连接后刷新
          </span>
        </div>
      )}

      {/* Messages */}
      <ErrorBoundary
        onError={(err) =>
          console.error("[chat-sidebar] message area render crashed:", err)
        }
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-6 px-4 py-4" aria-live="polite" aria-relevant="additions">
          {sessionsLoading || messagesLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <ChatSkills onSend={handleSend} />
          ) : (
            messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                contentBlocks={msg.contentBlocks}
                isStreaming={
                  streaming &&
                  msg.role === "assistant" &&
                  msg === messages[messages.length - 1]
                }
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ErrorBoundary>

      {ws.runs.filter(run => run.sessionId === activeSessionId && !['receiving', 'not_submitted'].includes(run.status)).map(run => (
        <div key={run.runId} className="px-4 pb-2 text-xs" role="status">
          <p>{run.message}</p>
          {run.status !== 'not_submitted' && <button type="button" className="mt-1 rounded border border-border px-3 py-1" onClick={() => void ws.recoverRun(run.runId)}>读取原请求结果</button>}
          <p className="mt-1 text-[11px] text-muted-foreground">请求 {run.runId.slice(0, 8)}；恢复仅读取本人会话的原结果，不会重新生成。</p>
        </div>
      ))}

      {streaming && (
        <div className="px-4 pb-2">
          <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={() => {
            abortRef.current = true
            if (activeRunId.current) ws.cancelRun(activeRunId.current)
          }}>停止接收</button>
          <p className="mt-1 text-[11px] text-muted-foreground">停止接收不会保证取消后台生成，费用仍可能产生。</p>
        </div>
      )}
      {/* Input */}
      <div className="relative">
        {atQuery !== null && mentionPickerItems.length > 0 && (
          <MessageMentionPicker
            items={mentionPickerItems}
            query={atQuery}
            onSelect={(item) => {
              handleMentionSelect(item);
              chatInputRef.current?.clearAtQuery();
              setAtQuery(null);
            }}
            onClose={() => setAtQuery(null)}
          />
        )}
        <BalanceConsent checked={balanceConsent.checked} change={balanceConsent.change} disabled={streaming || sessionsLoading || messagesLoading || !activeSessionId} />
        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          disabled={streaming || sessionsLoading || messagesLoading || !activeSessionId}
          inputDisabled={sessionsLoading || messagesLoading || !activeSessionId}
          attachments={imageAttachments}
          onAddFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onRetryAttachment={retryUpload}
          isUploading={isUploading}
          onAtQuery={setAtQuery}
          mentions={messageMentions}
          onRemoveMention={handleRemoveMention}
          {...(selectedCanvasElements ? { selectedCanvasElements } : {})}
        />
      </div>
    </>
  );

  // ── Mobile / Tablet: full-screen overlay with backdrop ──
  if (isOverlay) {
    return (
      <>
        {/* Semi-transparent backdrop — click to close */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop is a non-interactive dismissal layer, keyboard close is handled via Escape */}
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200"
          onClick={onToggle}
        />
        {/* Chat panel — full screen on mobile, fixed-width drawer on tablet */}
        <div
          className={
            breakpoint === "mobile"
              ? "fixed inset-0 z-50 flex flex-col bg-card animate-in slide-in-from-right duration-250"
              : "fixed inset-y-0 right-0 z-50 flex w-[400px] flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-250"
          }
          {...eventIsolationProps}
        >
          {panelContent}
        </div>
      </>
    );
  }

  // ── Desktop: inline side-by-side with resize handle ──
  return (
    <div
      ref={desktopPanel}
      className="loomic-agent-panel flex h-full min-w-0 shrink-0"
      style={{ width: sidebarWidth }}
      {...eventIsolationProps}
    >
      {/* Resize handle -- supports mouse, touch, and keyboard (ArrowLeft/ArrowRight) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整助手面板宽度"
        aria-valuenow={sidebarWidth}
        aria-valuemin={Math.min(SIDEBAR_MIN, sidebarMax)}
        aria-valuemax={sidebarMax}
        tabIndex={0}
        className="w-1 shrink-0 cursor-col-resize border-l border-border transition-colors hover:bg-muted-foreground/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onKeyDown={handleResizeKeyDown}
      />
      <div className="flex flex-1 flex-col bg-card min-w-0">
        {panelContent}
      </div>
    </div>
  );
}
