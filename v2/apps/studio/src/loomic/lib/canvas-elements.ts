import type { ImageArtifact, VideoArtifact } from "@loomic/shared";

import { getServerBaseUrl } from "./env";

/** Video file extensions recognized for inline playback on canvas. */
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".mov"];

/**
 * Check if a URL points to a video file based on extension or customData hint.
 * Used by canvas-editor (renderEmbeddable) and canvas-tool-menu (selection detection).
 */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    // Strip query params/hash for extension check
    const pathname = new URL(url, "https://placeholder").pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    // Fallback: raw string check
    const lower = url.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
  }
}

/**
 * Scale dimensions to fit within maxSize while preserving aspect ratio.
 */
export function scaleToFit(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Compute the center of the current Excalidraw viewport.
 */
export function getViewportCenter(appState: {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
}): { x: number; y: number } {
  const zoom = appState.zoom?.value ?? 1;
  return {
    x: -appState.scrollX + appState.width / (2 * zoom),
    y: -appState.scrollY + appState.height / (2 * zoom),
  };
}

/**
 * Create an Excalidraw image element with all required fields.
 */
export function createExcalidrawImageElement(opts: {
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  source?: "generated" | "uploaded";
  storageUrl?: string;
}): Record<string, unknown> {
  const element: Record<string, unknown> = {
    type: "image",
    id: generateId(),
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    angle: 0,
    fileId: opts.fileId,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    roundness: null,
    boundElements: null,
    frameId: null,
    index: null,
    seed: Math.floor(Math.random() * 2_000_000_000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
  if (opts.title || opts.source || opts.storageUrl) {
    element.customData = {
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.storageUrl ? { storageUrl: opts.storageUrl } : {}),
    };
  }
  return element;
}

/**
 * Fetch an image URL and convert it to a data URL string.
 * Routes through the server proxy to bypass browser CORS restrictions.
 */
export async function fetchAsDataURL(url: string): Promise<string> {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 40 * 1024 * 1024) {
    throw new Error('图片必须由同源生成服务返回，或来自本地导入');
  }
  return url;
}

/**
 * Insert an image artifact onto the Excalidraw canvas.
 */
export async function insertImageOnCanvas(
  api: {
    addFiles: (
      files: { id: any; dataURL: any; mimeType: string; created: number }[],
    ) => void;
    getSceneElements: () => readonly any[];
    getAppState: () => any;
    updateScene: (scene: {
      elements: any[];
      captureUpdate?: string;
    }) => void;
  },
  artifact: ImageArtifact,
): Promise<void> {
  const dataURL = await fetchAsDataURL(artifact.url);
  const fileId = generateId();

  api.addFiles([
    {
      id: fileId as any,
      dataURL: dataURL as any,
      mimeType: artifact.mimeType,
      created: Date.now(),
    },
  ]);

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (artifact.placement) {
    // Agent-controlled placement
    x = artifact.placement.x;
    y = artifact.placement.y;
    width = artifact.placement.width;
    height = artifact.placement.height;
  } else {
    // Smart auto-placement: viewport center if empty, next to elements if not
    const scaled = scaleToFit(artifact.width, artifact.height, 600);
    width = scaled.width;
    height = scaled.height;

    const elements = api.getSceneElements().filter((el: any) => !el.isDeleted);

    if (elements.length === 0) {
      // Empty canvas → viewport center
      const center = getViewportCenter(api.getAppState());
      x = center.x - width / 2;
      y = center.y - height / 2;
    } else {
      // Has elements → place to the right of the rightmost element with gap
      const GAP = 40;
      let maxRight = -Infinity;
      let rightEdgeY = 0;

      for (const el of elements) {
        const elRight = (el.x ?? 0) + (el.width ?? 0);
        if (elRight > maxRight) {
          maxRight = elRight;
          // Vertically align center of new image with center of rightmost element
          rightEdgeY = (el.y ?? 0) + (el.height ?? 0) / 2;
        }
      }

      x = maxRight + GAP;
      y = rightEdgeY - height / 2;
    }
  }

  const element = createExcalidrawImageElement({
    fileId,
    x,
    y,
    width,
    height,
    ...(artifact.title ? { title: artifact.title } : {}),
    source: "generated",
    storageUrl: artifact.url,
  });

  api.updateScene({
    elements: [...api.getSceneElements(), element],
    captureUpdate: "IMMEDIATELY",
  });
}

/**
 * Insert a video artifact onto the Excalidraw canvas as an embeddable element.
 * Uses Excalidraw's native embeddable type with renderEmbeddable callback for inline playback.
 * No poster frame extraction needed -- the video plays directly on canvas.
 */
export async function insertVideoOnCanvas(
  api: {
    getSceneElements: () => readonly any[];
    getAppState: () => any;
    updateScene: (scene: {
      elements: any[];
      captureUpdate?: string;
    }) => void;
  },
  artifact: VideoArtifact,
): Promise<void> {
  // Dynamic import — excalidraw is client-only and cannot be imported at module level
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (artifact.placement) {
    x = artifact.placement.x;
    y = artifact.placement.y;
    width = artifact.placement.width;
    height = artifact.placement.height;
  } else {
    // Use 800px max for video elements (larger than images since video benefits from more screen area)
    const scaled = scaleToFit(artifact.width, artifact.height, 800);
    width = scaled.width;
    height = scaled.height;

    const elements = api.getSceneElements().filter((el: any) => !el.isDeleted);

    if (elements.length === 0) {
      // Empty canvas -- place at viewport center
      const center = getViewportCenter(api.getAppState());
      x = center.x - width / 2;
      y = center.y - height / 2;
    } else {
      // Has elements -- place to the right of the rightmost element with gap
      const GAP = 40;
      let maxRight = -Infinity;
      let rightEdgeY = 0;
      for (const el of elements) {
        const elRight = (el.x ?? 0) + (el.width ?? 0);
        if (elRight > maxRight) {
          maxRight = elRight;
          rightEdgeY = (el.y ?? 0) + (el.height ?? 0) / 2;
        }
      }
      x = maxRight + GAP;
      y = rightEdgeY - height / 2;
    }
  }

  const newElements = convertToExcalidrawElements([
    {
      type: "embeddable",
      link: artifact.url,
      x,
      y,
      width,
      height,
      customData: {
        isVideo: true,
        mimeType: artifact.mimeType,
        durationSeconds: artifact.durationSeconds,
        title: artifact.title?.slice(0, 60),
        prompt: artifact.title,
      },
    } as any, // ExcalidrawElementSkeleton includes IframeLikeElement but TS needs a nudge
  ]);

  const existing = api.getSceneElements();
  api.updateScene({
    elements: [...existing, ...newElements],
    captureUpdate: "IMMEDIATELY",
  });
}

function generateId(): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  ).slice(0, 20);
}
