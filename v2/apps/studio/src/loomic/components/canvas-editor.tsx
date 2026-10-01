"use client";

import "@excalidraw/excalidraw/index.css";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from "react";

import type { WebSocketHandle } from "../hooks/use-websocket";
import { saveCanvas, uploadThumbnail } from "../lib/server-api";
import { subscribeDraftDeletion, retainDraftScene, hasRecoveredDraft } from "../lib/local-drafts";
import { VideoCanvasElement } from "./canvas/video-canvas-element";
import { isVideoUrl } from "../lib/canvas-elements";
import { CanvasToolMenu } from "./canvas-tool-menu";
import { normalizeCanvasElements } from "../lib/canvas-normalize";
import { ErrorBoundary } from "./error-boundary";
import { useWorkspaceLeaveGuard } from "../../workspace/WorkspaceNavigationProvider";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

// Safari <16.4 does not support requestIdleCallback — provide a fallback
// that defers via setTimeout(cb, 1) to approximate idle scheduling.
const ric: typeof requestIdleCallback =
  typeof window !== "undefined" && window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : ((cb: IdleRequestCallback) => setTimeout(cb, 1) as unknown as number);
const cic: typeof cancelIdleCallback =
  typeof window !== "undefined" && window.cancelIdleCallback
    ? window.cancelIdleCallback.bind(window)
    : clearTimeout;

// Memoize CanvasToolMenu to prevent re-renders when parent state changes
// (e.g. selection changes in the editor don't need to re-render the toolbar)
const MemoizedCanvasToolMenu = memo(CanvasToolMenu);

export type CanvasSelectedElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fileId?: string;
  dataUrl?: string;
  /** Reserved by the upstream selection contract; local drafts use dataUrl. */
  storageUrl?: string;
};

type CanvasEditorProps = {
  canvasId: string;
  projectId: string;
  accessToken: string;
  initialContent: {
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  };
  onApiReady?: (api: any) => void;
  ws?: WebSocketHandle;
  leftPanelOpen?: boolean;
  onSelectionChange?: (elements: CanvasSelectedElement[]) => void;
};

const SAVE_DEBOUNCE_MS = 1500;
const THUMBNAIL_DEBOUNCE_MS = 10_000;
const THUMBNAIL_MAX_SIZE = 400;

export function CanvasEditor({
  canvasId,
  projectId,
  accessToken,
  initialContent,
  onApiReady,
  ws,
  leftPanelOpen,
  onSelectionChange,
}: CanvasEditorProps) {
  const { resolvedTheme } = useTheme();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const canvasIdRef = useRef(canvasId);
  canvasIdRef.current = canvasId;
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const prevSelectedIdsRef = useRef<string>("");
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  // Tracks whether the one-time normalization pass has already run
  const normalizedRef = useRef(false);
  const loadedApiRef = useRef<any>(null);
  const onApiReadyRef = useRef(onApiReady); onApiReadyRef.current = onApiReady;
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(() => hasRecoveredDraft(accessToken, canvasId));
  const recoveredOnMount = useRef(hasRecoveredDraft(accessToken, canvasId));
  const savingRef = useRef<Promise<void> | null>(null);
  const aliveRef = useRef(true);
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const deletedDraftRef = useRef(false);
  useLayoutEffect(() => {
    deletedDraftRef.current = false;
    return subscribeDraftDeletion(accessToken, canvasId, () => {
      deletedDraftRef.current = true;
      pendingSaveRef.current = null;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    });
  }, [accessToken, canvasId]);

  // Guard: prevent auto-save until Excalidraw has fully hydrated with initial data.
  // Without this, a page reload can fire onChange with empty elements before
  // initialData is applied, causing a FULL REPLACE that wipes existing content.
  const hydratedRef = useRef(false);
  const initialElementCountRef = useRef(initialContent.elements.filter((e) => !e.isDeleted).length);

  // Preserve the latest scene until its IndexedDB write succeeds.
  const pendingSaveRef = useRef<{
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  } | null>(null);

  const savePending = useCallback(async () => {
    if (deletedDraftRef.current) return;
    if (savingRef.current) await savingRef.current;
    const content = pendingSaveRef.current;
    if (!content) return;
    const task = saveCanvas(accessToken, canvasId, content).then(() => {
      if (pendingSaveRef.current === content) pendingSaveRef.current = null;
      setSaveError(false);
    }).catch(error => {
      setSaveError(true);
      window.dispatchEvent(new Event("gouo:draft-save-failed"));
      throw error;
    });
    savingRef.current = task;
    try { await task; } finally { if (savingRef.current === task) savingRef.current = null; }
  }, [accessToken, canvasId]);
  const flushForNavigation = useCallback(async () => {
    if (deletedDraftRef.current) return true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    try {
      // Save one newer snapshot if editing changes during the first write.
      // Continuing edits keep the page open instead of an unbounded flush loop.
      for (let attempt = 0; attempt < 2; attempt++) {
        await savePending();
        if (!pendingSaveRef.current && !savingRef.current) return true;
      }
      setSaveError(true);
      return false;
    } catch { return false; }
  }, [savePending]);
  useWorkspaceLeaveGuard(flushForNavigation);

  const handleExcalidrawApi = useCallback(
    (api: any) => {
      loadedApiRef.current = api;
      setExcalidrawApi(api);
    },
    [onApiReady],
  );

  const handleChange = useCallback(
    (elements: readonly any[], appState: any) => {
      // Skip auto-save until Excalidraw has fully hydrated with initial data.
      // During initialization, onChange may fire with empty/partial elements
      // which would wipe the persisted canvas via FULL REPLACE.
      if (!aliveRef.current || deletedDraftRef.current || !loadedApiRef.current || appState.isLoading) return;
      if (!hydratedRef.current) {
        if (elements.filter((el: any) => !el.isDeleted).length < initialElementCountRef.current) return;
        hydratedRef.current = true;
        setReady(true);
        onApiReadyRef.current?.(loadedApiRef.current);
      }

      // Snapshot while the editor is alive. Its SDK clears scene state during
      // teardown, so reading the API in an unmount cleanup would erase a draft.
      const files: Record<string, Record<string, unknown>> = {};
      for (const [id, file] of Object.entries(loadedApiRef.current.getFiles() as Record<string, any>)) {
        files[id] = { id: file.id, dataURL: file.dataURL, mimeType: file.mimeType, created: file.created };
      }
      const content = { elements: elements.filter((el: any) => !el.isDeleted) as Record<string, unknown>[],
        appState: { viewBackgroundColor: appState.viewBackgroundColor, gridModeEnabled: appState.gridModeEnabled,
          scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom }, files };
      pendingSaveRef.current = content;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void savePending().catch(() => undefined);
      }, SAVE_DEBOUNCE_MS);

      // --- 2. Debounced thumbnail (runs much less frequently than save) ---
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = setTimeout(async () => {
        if (!excalidrawApi) return;
        try {
          const { exportToBlob } = await import("@excalidraw/excalidraw");
          const sceneElements = excalidrawApi.getSceneElements();
          const sceneFiles = excalidrawApi.getFiles();
          if (!sceneElements.length) return;

          const blob = await exportToBlob({
            elements: sceneElements,
            appState: { exportBackground: true },
            files: sceneFiles,
            mimeType: "image/webp",
            quality: 0.8,
            maxWidthOrHeight: THUMBNAIL_MAX_SIZE,
          });

          await uploadThumbnail(accessTokenRef.current, projectId, blob);
        } catch (err) {
          console.warn("[canvas-editor] local thumbnail save failed:", err);
        }
      }, THUMBNAIL_DEBOUNCE_MS);

      // --- 3. Selection change detection ---
      // Cheap string comparison avoids unnecessary downstream re-renders.
      const selectedIds = appState.selectedElementIds
        ? Object.keys(appState.selectedElementIds as Record<string, boolean>).filter(
            (id) => (appState.selectedElementIds as Record<string, boolean>)[id],
          ).sort().join(",")
        : "";

      if (selectedIds !== prevSelectedIdsRef.current) {
        prevSelectedIdsRef.current = selectedIds;
        if (onSelectionChangeRef.current) {
          if (!selectedIds) {
            onSelectionChangeRef.current([]);
          } else {
            const idSet = new Set(selectedIds.split(","));
            const selFiles: Record<string, any> = excalidrawApi?.getFiles() ?? {};
            const selected: CanvasSelectedElement[] = elements
              .filter((el: any) => idSet.has(el.id) && !el.isDeleted)
              .map((el: any) => {
                const base: CanvasSelectedElement = {
                  id: el.id,
                  type: el.type,
                  x: el.x ?? 0,
                  y: el.y ?? 0,
                  width: el.width ?? 0,
                  height: el.height ?? 0,
                };
                if (el.type === "text" && el.text) {
                  base.text = el.text;
                }
                if (el.type === "image" && el.fileId) {
                  base.fileId = el.fileId;
                  const file = selFiles[el.fileId];
                  if (file?.dataURL) {
                    base.dataUrl = file.dataURL;
                  }
                }
                return base;
              });
            onSelectionChangeRef.current(selected);
          }
        }
      }
    },
    [canvasId, projectId, excalidrawApi, savePending],
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingSaveRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
      if (!deletedDraftRef.current && pendingSaveRef.current) {
        retainDraftScene(accessToken, canvasId, pendingSaveRef.current);
      }
    };
  }, [accessToken, canvasId]);

  // Render custom embeddable content for video elements on canvas.
  // Excalidraw calls this for every embeddable element; we intercept video URLs
  // and render an inline player, falling back to default for everything else.
  const renderEmbeddable = useCallback(
    (element: any, _appState: any) => {
      const link = element?.link;
      if (typeof link === "string" && isVideoUrl(link)) {
        return (
          <VideoCanvasElement
            src={link}
            width={element.width ?? 640}
            height={element.height ?? 360}
          />
        );
      }
      // Return null to let Excalidraw handle non-video embeddables with default behavior
      return null;
    },
    [],
  );

  // Remote embeds stay disabled while cloud assets are deferred.
  const validateEmbeddable = useCallback((element: any) => typeof element?.link === "string" && /^(blob:|data:video\/)/.test(element.link), []);

  return (
    <ErrorBoundary
      onError={(err) => console.error("[canvas-editor] render crashed:", err)}
    >
      <div className="h-full w-full relative">
        {saveError && <div role="alert" className="absolute top-3 left-1/2 -translate-x-1/2 z-50 rounded bg-red-50 p-3 text-red-800">
          {recoveredOnMount.current && <p>已恢复此账号在当前页面进程内保留的画布副本，尚未保存；关闭浏览器后不保证恢复。</p>}
          画布尚未保存，已留在当前页面。请重试保存或从菜单导出画布文件。
          <button type="button" onClick={() => { void flushForNavigation(); }} className="ml-3 underline">重试保存</button>
        </div>}
        <Excalidraw
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          langCode="zh-CN"
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
          initialData={{
            elements: initialContent.elements as any,
            appState: initialContent.appState as any,
            files: initialContent.files as any,
          }}
          onChange={handleChange}
          excalidrawAPI={handleExcalidrawApi}
          renderEmbeddable={renderEmbeddable}
          validateEmbeddable={validateEmbeddable}
        />
        {excalidrawApi && ready && (
          <MemoizedCanvasToolMenu
            accessToken={accessToken}
            excalidrawApi={excalidrawApi}
            leftPanelOpen={leftPanelOpen ?? false}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
