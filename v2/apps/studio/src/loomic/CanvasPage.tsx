"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";

import type { ImageArtifact, VideoArtifact } from "@loomic/shared";
import type { CanvasImageItem } from "./components/canvas-image-picker";
import type { CanvasSelectedElement } from "./components/canvas-editor";
function LoadingScreen() { return <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">正在打开创作空间…</div> }
import { useAuth } from "./lib/auth-context";
import { useWebSocket } from "./hooks/use-websocket";
import { CanvasEditor } from "./components/canvas-editor";
import { ChatSidebar } from "./components/chat-sidebar";
import { CanvasEmptyHint } from "./components/canvas-empty-hint";
import { CanvasLogoMenu } from "./components/canvas-logo-menu";
import { EditableProjectName } from "./components/editable-project-name";
import { insertImageOnCanvas, insertVideoOnCanvas } from "./lib/canvas-elements";
import { fetchCanvas, fetchProject, ApiAuthError } from "./lib/server-api";
import { CanvasBottomBar } from "./components/canvas-bottom-bar";
import { CanvasFilesPanel } from "./components/canvas-files-panel";
import { CanvasLayersPanel } from "./components/canvas-layers-panel";
import { AccountMenu } from "./components/account-menu";
import { useToast } from "./components/toast";

function CanvasPageContent() {
  const searchParams = useSearchParams();
  const canvasId = searchParams.get("id") || "draft";
  const initialSessionId = searchParams.get("session") ?? undefined;
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [canvasData, setCanvasData] = useState<{
    owner: string;
    id: string;
    name: string;
    projectId: string;
    content: {
      elements: Record<string, unknown>[];
      appState: Record<string, unknown>;
      files: Record<string, Record<string, unknown>>;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  // Default chat open on desktop, closed on mobile/tablet to avoid blocking canvas
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<CanvasSelectedElement[]>([]);

  const excalidrawApiRef = useRef<any>(null);
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);

  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const routerRef = useRef(router);
  routerRef.current = router;

  // Stable callbacks for panel toggles to prevent re-renders of child components
  const handleOpenChat = useCallback(() => setChatOpen(true), []);
  const handleToggleChat = useCallback(() => setChatOpen((v) => !v), []);
  const handleToggleLayers = useCallback(() => { setLayersOpen((v) => !v); setFilesOpen(false); }, []);
  const handleToggleFiles = useCallback(() => { setFilesOpen((v) => !v); setLayersOpen(false); }, []);
  const handleCloseLayers = useCallback(() => setLayersOpen(false), []);
  const handleCloseFiles = useCallback(() => setFilesOpen(false), []);

  const accessToken = `local:${user?.id ?? "guest"}`;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const getToken = useCallback(() => accessTokenRef.current ?? null, []);
  const ws = useWebSocket(getToken);

  const handleApiReady = useCallback((api: any) => {
    excalidrawApiRef.current = api;
    setExcalidrawApi(api);
  }, []);

  const handleImageGenerated = useCallback((artifact: ImageArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    insertImageOnCanvas(api, artifact).catch(() => {
      toast.error("图片未能加入画布，请从对话结果下载备份");
    });
  }, [toast]);

  const handleVideoGenerated = useCallback((artifact: VideoArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    insertVideoOnCanvas(api, artifact).catch(() => {
      toast.error("视频未能加入画布，请从对话结果下载备份");
    });
  }, [toast]);

  // Consume Loomic canvas-sync events from the local document boundary.
  const handleCanvasSync = useCallback(async () => {
    const api = excalidrawApiRef.current;
    const token = accessTokenRef.current;
    if (!api || !token || !canvasData) return;
    try {
      const { canvas } = await fetchCanvas(token, canvasData.id);
      const elements = canvas.content.elements ?? [];
      const files = (canvas.content as Record<string, unknown>).files as
        Record<string, { id: string; dataURL: string; mimeType: string; created: number }> | undefined;

      // Restore inline image files from the local draft.
      if (files && Object.keys(files).length > 0) {
        api.addFiles(Object.values(files));
      }

      api.updateScene({ elements, captureUpdate: "IMMEDIATELY" });
    } catch (err) {
      console.warn("Failed to sync canvas:", err);
    }
  }, [canvasData]);

  const handleSessionChange = useCallback(
    (sessionId: string) => {
      if (!canvasId) return;
      // Update URL: set session param, remove prompt param to prevent re-send on refresh
      routerRef.current.replace(`/canvas?id=${canvasId}&session=${sessionId}`);
    },
    [canvasId],
  );

  const handleRequestCanvasImages = useCallback((): CanvasImageItem[] => {
    const api = excalidrawApiRef.current;
    if (!api) return [];
    const elements: any[] = api.getSceneElements() ?? [];
    const files: Record<string, any> = api.getFiles() ?? {};
    let idx = 0;
    return elements
      .filter((el: any) => el.type === "image" && !el.isDeleted && el.fileId)
      .map((el: any) => {
        idx++;
        const file = files[el.fileId];
        const dataURL = file?.dataURL ?? "";
        const title =
          el.customData?.title ||
          el.customData?.label ||
          `Image ${idx}`;
        return {
          kind: "canvas-image",
          id: el.id,
          name: title,
          thumbnailUrl: dataURL,
          assetId: el.id,
          url: dataURL,
          mimeType: file?.mimeType ?? "image/png",
        };
      });
  }, []);

  // Only re-fetch when canvasId changes or on initial auth resolution.
  // Token refreshes (e.g. tab switch back) should NOT trigger a reload —
  // we depend on user.id (stable string) instead of the user object ref.
  const userId = user?.id;

  useEffect(() => {
    if (authLoading) return;
    const token = accessTokenRef.current;
    if (!canvasId || !token) return;

    let disposed = false;
    setPageLoading(true);
    setError(null);
    setExcalidrawApi(null);
    excalidrawApiRef.current = null;
    setSelectedCanvasElements([]);
    fetchCanvas(token, canvasId)
      .then((data) => {
        if (disposed) return;
        const c = data.canvas;
        setCanvasData({
          owner: token,
          id: c.id,
          name: c.name,
          projectId: c.projectId,
          content: {
            elements: c.content.elements ?? [],
            appState: c.content.appState ?? {},
            files: (c.content as any).files ?? {},
          },
        });
        setPageLoading(false);
        // Fetch project to get brand_kit_id and name
        fetchProject(token, c.projectId)
          .then((projectData) => {
            if (disposed) return;
            setBrandKitId(projectData.project.brand_kit_id);
            setProjectName(projectData.project.name ?? "Untitled");
          })
          .catch((err) => console.warn("Failed to fetch project for brand kit:", err));
      })
      .catch((err) => {
        if (disposed) return;
        if (err instanceof ApiAuthError) {
          signOutRef.current().then(() => routerRef.current.replace("/login"));
          return;
        }
        setError(err instanceof Error ? err.message : "无法打开本地画布");
        setPageLoading(false);
      });
    return () => { disposed = true; };
    // Intentionally omitting accessTokenRef (stable ref) and signOutRef/routerRef
    // (ref wrappers) from deps — only re-run when auth resolves, user changes, or
    // canvasId changes. Token refresh (e.g. tab switch) must NOT trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userId, canvasId]);

  if (!canvasId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">No canvas ID specified.</p>
      </div>
    );
  }

  if (authLoading || pageLoading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (canvasData && (canvasData.owner !== accessToken || canvasData.id !== canvasId)) return <LoadingScreen />;
  if (!canvasData || !accessToken) return null;

  return (
    <div className="flex h-dvh w-screen overflow-hidden">
      {/* Top-left navigation bar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5">
        <CanvasLogoMenu
          accessToken={accessToken}
          projectId={canvasData.projectId}
          canvasId={canvasData.id}
          excalidrawApi={excalidrawApi}
        />
        <EditableProjectName
          accessToken={accessToken}
          projectId={canvasData.projectId}
          key={accessToken + canvasData.id}
          initialName={projectName}
        />
      </div>
      {/* Canvas always takes full width; on mobile/tablet, ChatSidebar overlays instead of side-by-side */}
      <div className="flex-1 relative min-w-0 overflow-hidden">
        {/* Local save and New API account controls */}
        <div className="absolute top-3 right-3 z-20">
          <AccountMenu owner={accessToken} canvasId={canvasData.id} api={excalidrawApi} />
        </div>
        <CanvasEditor
          key={accessToken + canvasData.id}
          canvasId={canvasData.id}
          projectId={canvasData.projectId}
          accessToken={accessToken}
          initialContent={canvasData.content}
          onApiReady={handleApiReady}
          ws={ws}
          leftPanelOpen={layersOpen || filesOpen}
          onSelectionChange={setSelectedCanvasElements}
        />
        <CanvasEmptyHint
          excalidrawApi={excalidrawApi}
          onOpenChat={handleOpenChat}
        />
        <CanvasBottomBar
          excalidrawApi={excalidrawApi}
          layersOpen={layersOpen}
          onToggleLayers={handleToggleLayers}
          filesOpen={filesOpen}
          onToggleFiles={handleToggleFiles}
          leftPanelOpen={layersOpen || filesOpen}
        />
        <CanvasLayersPanel
          excalidrawApi={excalidrawApi}
          open={layersOpen}
          onClose={handleCloseLayers}
        />
        <CanvasFilesPanel
          excalidrawApi={excalidrawApi}
          open={filesOpen}
          onClose={handleCloseFiles}
        />
      </div>
      <ChatSidebar
        key={accessToken + canvasData.id}
        accessToken={accessToken}
        canvasId={canvasData.id}
        open={chatOpen}
        onToggle={handleToggleChat}
        onImageGenerated={handleImageGenerated}
        onVideoGenerated={handleVideoGenerated}
        onCanvasSync={handleCanvasSync}
        initialSessionId={initialSessionId}
        onSessionChange={handleSessionChange}
        onRequestCanvasImages={handleRequestCanvasImages}
        currentBrandKitId={brandKitId}
        ws={ws}
        selectedCanvasElements={selectedCanvasElements}
      />
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <CanvasPageContent />
    </Suspense>
  );
}
