"use client";

import "@excalidraw/excalidraw/index.css";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, memo } from "react";

import type { WebSocketHandle } from "../hooks/use-websocket";
import { saveCanvas, uploadThumbnail } from "../lib/server-api";
import { VideoCanvasElement } from "./canvas/video-canvas-element";
import { isVideoUrl } from "../lib/canvas-elements";
import { CanvasToolMenu } from "./canvas-tool-menu";
import { normalizeCanvasElements } from "../lib/canvas-normalize";
import { ErrorBoundary } from "./error-boundary";

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

  // Guard: prevent auto-save until Excalidraw has fully hydrated with initial data.
  // Without this, a page reload can fire onChange with empty elements before
  // initialData is applied, causing a FULL REPLACE that wipes existing content.
  const hydratedRef = useRef(false);
  const initialElementCountRef = useRef(initialContent.elements.filter((e) => !e.isDeleted).length);

  // Track pending save payload so we can flush on tab close / unmount
  const pendingSaveRef = useRef<{
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  } | null>(null);

  const lastContentRef = useRef<CanvasEditorProps['initialContent'] | null>(null);

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
      if (!loadedApiRef.current || appState.isLoading) return;
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
      lastContentRef.current = content;
      pendingSaveRef.current = content;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveCanvas(accessTokenRef.current, canvasId, content).then(() => {
          if (pendingSaveRef.current === content) pendingSaveRef.current = null;
        }).catch(() => window.dispatchEvent(new Event("gouo:draft-save-failed")));
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
    [canvasId, projectId, excalidrawApi],
  );

  // Preserve the final scene independently of SDK cleanup order.
  const buildSavePayload = useCallback(() => hydratedRef.current ? lastContentRef.current : null, []);

  // Keep buildSavePayload accessible without stale closures
  const buildSavePayloadRef = useRef(buildSavePayload);
  buildSavePayloadRef.current = buildSavePayload;

  // Flush pending save on page close (beforeunload) and component unmount
  useEffect(() => {
    const flushBeforeUnload = () => {
      if (!pendingSaveRef.current) return;

      // Build the real payload since pendingSaveRef may hold a placeholder
      const payload = buildSavePayloadRef.current();
      if (!payload) return;

      void saveCanvas(accessTokenRef.current, canvasIdRef.current, payload).catch(() => {
        window.dispatchEvent(new Event("gouo:draft-save-failed"));
      });
      pendingSaveRef.current = null;
    };

    window.addEventListener("beforeunload", flushBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);

      // Cancel pending debounce timers
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);

      // Flush pending save on component unmount (e.g. SPA navigation)
      if (pendingSaveRef.current) {
        const payload = buildSavePayloadRef.current();
        if (payload) {
          saveCanvas(accessTokenRef.current, canvasIdRef.current, payload).catch(
            console.error,
          );
        }
        pendingSaveRef.current = null;
      }
    };
  }, []);

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
