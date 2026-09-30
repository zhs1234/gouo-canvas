"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type VideoPlayerPanelProps = {
  elementId: string;
  elementBounds: { x: number; y: number; width: number; height: number };
  videoUrl: string;
  mimeType: string;
  durationSeconds?: number;
  title?: string;
  canvasScrollZoom: { scrollX: number; scrollY: number; zoom: number };
  onClose: () => void;
};

export function VideoPlayerPanel({
  elementId,
  elementBounds,
  videoUrl,
  mimeType,
  durationSeconds,
  title,
  canvasScrollZoom,
  onClose,
}: VideoPlayerPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [screenX, setScreenX] = useState(0);
  const [screenY, setScreenY] = useState(0);

  // Position panel below the selected element (same pattern as video-generator-panel)
  useEffect(() => {
    const { scrollX, scrollY, zoom } = canvasScrollZoom;
    const x = (elementBounds.x + scrollX) * zoom;
    const y = (elementBounds.y + elementBounds.height + scrollY) * zoom + 12;
    setScreenX(Math.max(8, Math.min(x, window.innerWidth - 520)));
    setScreenY(Math.max(8, Math.min(y, window.innerHeight - 400)));
  }, [elementBounds, canvasScrollZoom]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      style={{ left: screenX, top: screenY }}
      className="fixed z-[100] w-[480px] rounded-2xl border border-border bg-card/95 shadow-card backdrop-blur-lg overflow-hidden"
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground truncate">
          <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span className="truncate">{title || "Video"}</span>
          {durationSeconds != null && (
            <span className="text-xs text-muted-foreground">{durationSeconds}s</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 hover:bg-muted/80 transition-colors"
        >
          <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Video Player */}
      <div className="bg-black">
        <video
          src={videoUrl}
          controls
          autoPlay
          playsInline
          className="w-full max-h-[320px] object-contain"
          style={{ display: "block" }}
        >
          <source src={videoUrl} type={mimeType} />
        </video>
      </div>

      {/* Footer with download */}
      <div className="flex items-center justify-end px-3 py-2 border-t border-border/50">
        <a
          href={videoUrl}
          download={`${title || "video"}.mp4`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          下载
        </a>
      </div>
    </div>,
    document.body,
  );
}
