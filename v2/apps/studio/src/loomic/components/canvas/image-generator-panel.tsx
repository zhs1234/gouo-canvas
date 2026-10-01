"use client";

import { BalanceConsent, useBalanceConsent } from "../../../BalanceConsent";
import { ImageUp, Lock, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ImageModelInfo } from "../../lib/server-api";
import { fetchImageModels, generateImageDirect, uploadFile } from "../../lib/server-api";
import { useGenerationErrorHandler } from "../../hooks/use-generation-error-handler";
import {
  updateImageGeneratorElement,
  resizeImageGeneratorElement,
  type ImageGeneratorData,
} from "../../lib/canvas-image-generator";
import {
  createExcalidrawImageElement,
  fetchAsDataURL,
} from "../../lib/canvas-elements";

type ImageGeneratorPanelProps = {
  elementId: string;
  elementBounds: { x: number; y: number; width: number; height: number };
  data: ImageGeneratorData;
  excalidrawApi: any;
  accessToken: string;
  canvasScrollZoom: { scrollX: number; scrollY: number; zoom: number };
  onClose: () => void;
};


function generateId(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  ).slice(0, 20);
}

export function ImageGeneratorPanel({
  elementId,
  elementBounds,
  data,
  excalidrawApi,
  accessToken,
  canvasScrollZoom,
  onClose,
}: ImageGeneratorPanelProps) {
  const balanceConsent = useBalanceConsent(accessToken + ":" + elementId);
  const [prompt, setPrompt] = useState(data.prompt);
  const [model, setModel] = useState(data.model);
  const [aspectRatio, setAspectRatio] = useState(data.aspectRatio);
  const [quality, setQuality] = useState(data.quality);
  const [loading, setLoading] = useState(data.status === "generating");
  const [error, setError] = useState<string | null>(data.errorMessage ?? null);
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showRatioDropdown, setShowRatioDropdown] = useState(false);
  const [showQualityDropdown, setShowQualityDropdown] = useState(false);
  const [refImages, setRefImages] = useState<Array<{ id: string; dataUrl: string; file: File }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const { handleGenerationError } = useGenerationErrorHandler();
  // AbortController for in-flight generation requests so we can cancel on unmount
  const abortRef = useRef<AbortController | null>(null);

  // Fetch available models with error logging
  useEffect(() => {
    let cancelled = false;
    fetchImageModels()
      .then((r) => {
        if (!cancelled) { setModels(r.models); const next = r.models.find(m => m.accessible); if (next && !model) { setModel(next.id); setQuality(next.qualities?.[0] ?? ""); setAspectRatio(next.aspectRatios?.[0] ?? ""); } }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "无法加载模型目录");
      });
    return () => { cancelled = true; };
  }, []);

  // Close dropdowns when clicking outside the panel
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
        setShowRatioDropdown(false);
        setShowQualityDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cancel in-flight generation on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [prompt]);

  // Calculate panel screen position from canvas coordinates
  const { scrollX, scrollY, zoom } = canvasScrollZoom;
  const screenX = (elementBounds.x + scrollX) * zoom;
  const screenY =
    (elementBounds.y + elementBounds.height + scrollY) * zoom + 8;
  const panelWidth = Math.min(450, window.innerWidth - 16);
  const left = Math.max(8, Math.min(screenX, window.innerWidth - panelWidth - 8));
  const top = Math.max(60, Math.min(screenY, window.innerHeight - 300));

  const currentModel = models.find((m) => m.id === model);
  const ASPECT_RATIOS = currentModel?.aspectRatios ?? [];
  const QUALITIES = (currentModel?.qualities ?? []).map(value => ({ value, label: value }));

  const handleAspectRatioChange = useCallback(
    (ratio: string) => {
      setAspectRatio(ratio);
      setShowRatioDropdown(false);
      resizeImageGeneratorElement(excalidrawApi, elementId, ratio);
      updateImageGeneratorElement(excalidrawApi, elementId, {
        aspectRatio: ratio,
      });
    },
    [excalidrawApi, elementId],
  );

  const handleQualityChange = useCallback(
    (q: string) => {
      setQuality(q);
      setShowQualityDropdown(false);
      updateImageGeneratorElement(excalidrawApi, elementId, { quality: q });
    },
    [excalidrawApi, elementId],
  );

  const handleModelChange = useCallback(
    (m: string) => {
      const next = models.find(model => model.id === m);
      if (!next?.accessible) return;
      const nextQuality = next.qualities?.[0] ?? "";
      const nextRatio = next.aspectRatios?.[0] ?? "";
      setModel(m);
      setQuality(nextQuality);
      setAspectRatio(nextRatio);
      setRefImages([]);
      setShowModelDropdown(false);
      resizeImageGeneratorElement(excalidrawApi, elementId, nextRatio);
      updateImageGeneratorElement(excalidrawApi, elementId, { model: m, quality: nextQuality, aspectRatio: nextRatio });
    },
    [excalidrawApi, elementId, models],
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    if (currentModel?.accessible !== true) { setError("尚未配置并验证可用图片模型"); return; }

    const payWithBalance = balanceConsent.consume();
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    updateImageGeneratorElement(excalidrawApi, elementId, {
      status: "generating",
      prompt: prompt.trim(),
      model,
      aspectRatio,
      quality,
    });

    try {
      const result = await generateImageDirect(
        accessTokenRef.current,
        prompt.trim(),
        { model, ...(payWithBalance ? { payWithBalance: true } : {}), ...(aspectRatio ? { aspectRatio } : {}), ...(quality ? { quality } : {}), inputImages: refImages.map(image => image.dataUrl) }, controller.signal,
      );

      // Check if this generation was cancelled while awaiting
      if (controller.signal.aborted) return;

      // Download and insert as real image element at same position
      const dataURL = await fetchAsDataURL(result.url);
      if (controller.signal.aborted) return;

      const fileId = generateId();
      excalidrawApi.addFiles([
        {
          id: fileId,
          dataURL,
          mimeType: result.mimeType,
          created: Date.now(),
        },
      ]);

      const imageElement = createExcalidrawImageElement({
        fileId,
        x: elementBounds.x,
        y: elementBounds.y,
        width: result.width * Math.min(elementBounds.width / result.width, elementBounds.height / result.height),
        height: result.height * Math.min(elementBounds.width / result.width, elementBounds.height / result.height),
        title: prompt.trim().slice(0, 60),
      });

      // Replace: delete placeholder, add image
      const elements = excalidrawApi
        .getSceneElements()
        .map((el: any) => {
          if (el.id === elementId) return { ...el, isDeleted: true };
          return el;
        });
      excalidrawApi.updateScene({
        elements: [...elements, imageElement],
        captureUpdate: "IMMEDIATELY",
      });

      onClose();
    } catch (err) {
      // Ignore aborted requests (user cancelled or component unmounted)
      if (controller.signal.aborted) return;

      console.error("[image-gen] Generation error:", err);
      const handled = handleGenerationError(err);
      if (!handled) {
        setError(err instanceof Error ? err.message : "图片生成失败，结果待确认，请检查网关记录");
      }
      setLoading(false);
      updateImageGeneratorElement(excalidrawApi, elementId, {
        status: "error",
        errorMessage: "生成失败",
      });
    }
  }, [
    prompt,
    balanceConsent.consume,
    loading,
    model,
    aspectRatio,
    quality,
    refImages,
    currentModel,
    excalidrawApi,
    elementId,
    elementBounds,
    onClose,
    handleGenerationError,
  ]);

  return createPortal(
    <div
      ref={panelRef}
      style={{ left, top, width: panelWidth }}
      className="fixed z-[100] rounded-xl border-[0.5px] border-border bg-card/95 p-2 shadow-card backdrop-blur-lg"
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Prompt textarea */}
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleGenerate();
          }
        }}
        placeholder="今天我们要创作什么"
        disabled={loading}
        style={{ scrollbarWidth: "none" }}
        className="min-h-[74px] max-h-[140px] w-full resize-none border-none bg-transparent p-1 text-[14px] leading-[18px] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-scrollbar]:hidden"
      />

      {error && (
        <div className="mb-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <BalanceConsent checked={balanceConsent.checked} change={balanceConsent.change} disabled={loading} />

      {/* Bottom toolbar */}
      <div className="mt-1 flex flex-wrap gap-1 items-center justify-between">
        {/* Left: model + ref image */}
        <div className="flex items-center">
          {/* Model selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModelDropdown((v) => !v)}
              className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              {currentModel?.iconUrl && (
                <img
                  src={currentModel.iconUrl}
                  alt=""
                  className="h-3.5 w-3.5 rounded-full"
                />
              )}
              <span className="text-foreground">
                {currentModel?.displayName ?? "选择模型"}
              </span>
              <svg
                className="h-3 w-3 text-muted-foreground"
                viewBox="0 0 12 24"
                fill="currentColor"
              >
                <path d="M8.546 10.33a.4.4 0 0 1 .566 0l.424.424a.4.4 0 0 1 0 .566l-3.041 3.041a.7.7 0 0 1-.99 0l-3.04-3.04a.4.4 0 0 1 0-.567l.423-.424a.4.4 0 0 1 .567 0L6 12.876z" />
              </svg>
            </button>
            {showModelDropdown && (
              <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[280px] w-[260px] overflow-y-auto rounded-xl border-[0.5px] border-border bg-card py-1 shadow-card">
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.accessible}
                    onClick={() => handleModelChange(m.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted ${m.id === model ? "bg-muted" : ""} ${m.accessible === false ? "opacity-60" : ""}`}
                  >
                    {m.iconUrl && (
                      <img
                        src={m.iconUrl}
                        alt=""
                        className="h-3.5 w-3.5 rounded-full"
                      />
                    )}
                    <span className="flex-1 text-foreground">
                      {m.displayName}
                      {m.accessible === false && (
                        <Lock className="ml-1 inline h-2.5 w-2.5 text-muted-foreground" />
                      )}
                    </span>
                    {typeof m.creditCost === "number" && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground">
                        <Zap className="h-2.5 w-2.5" />
                        {m.creditCost}
                      </span>
                    )}
                    {m.id === model && (
                      <svg
                        className="h-3 w-3 text-foreground"
                        viewBox="0 0 14 14"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.08 3.087a.583.583 0 0 1 0 .825L5.661 10.33a.583.583 0 0 1-.824 0L1.92 7.412a.583.583 0 0 1 .825-.825L5.25 9.092l6.004-6.005a.583.583 0 0 1 .825 0"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reference image upload */}
          <input
            ref={refInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (refImages.length + files.length > 4) { setError("最多使用 4 张参考图"); return; }
              try {
                const prepared: Array<{ id: string; dataUrl: string; file: File }> = [];
                for (const file of files) {
                  if (file.size > 8 * 1024 * 1024) throw new Error("参考图不能超过 8 MB");
                  const { url } = await uploadFile(accessTokenRef.current, file);
                  prepared.push({ id: generateId(), dataUrl: url, file });
                }
                setRefImages(prev => [...prev, ...prepared]);
                setError(null);
              } catch (error) { setError(error instanceof Error ? error.message : "参考图无法读取"); }
            }}
          />
          <button
            type="button"
            disabled={!currentModel?.accessible || !currentModel.operations?.includes('edit')}
            onClick={() => refInputRef.current?.click()}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-muted ${
              refImages.length > 0 ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            title="添加参考图"
          >
            <ImageUp className="h-3.5 w-3.5" />
          </button>
          {/* Ref image thumbnails */}
          {refImages.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {refImages.map((img) => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.dataUrl}
                    alt="ref"
                    className="h-7 w-7 rounded object-cover border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setRefImages((prev) => prev.filter((r) => r.id !== img.id))}
                    className="absolute -top-1 -right-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[8px]"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: quality + ratio + generate */}
        <div className="flex items-center gap-1">
          {/* Verified channel quality values */}
          <div className="relative">
            <button
              type="button"
              disabled={!QUALITIES.length}
              onClick={() => setShowQualityDropdown((v) => !v)}
              className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              <span className="text-foreground">
                {QUALITIES.find((q) => q.value === quality)?.label ?? "默认质量"}
              </span>
              <svg
                className="h-3 w-3 text-muted-foreground"
                viewBox="0 0 12 24"
                fill="currentColor"
              >
                <path d="M8.546 10.33a.4.4 0 0 1 .566 0l.424.424a.4.4 0 0 1 0 .566l-3.041 3.041a.7.7 0 0 1-.99 0l-3.04-3.04a.4.4 0 0 1 0-.567l.423-.424a.4.4 0 0 1 .567 0L6 12.876z" />
              </svg>
            </button>
            {showQualityDropdown && (
              <div className="absolute bottom-full right-0 z-50 mb-1 rounded-lg border-[0.5px] border-border bg-card py-1 shadow-card">
                {QUALITIES.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    onClick={() => handleQualityChange(q.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-muted ${q.value === quality ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Aspect ratio */}
          <div className="relative">
            <button
              type="button"
              disabled={!ASPECT_RATIOS.length}
              onClick={() => setShowRatioDropdown((v) => !v)}
              className="flex h-8 items-center gap-0.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              <span className="text-foreground">{aspectRatio || "默认比例"}</span>
              <svg
                className="h-3 w-3 text-muted-foreground"
                viewBox="0 0 12 24"
                fill="currentColor"
              >
                <path d="M8.546 10.33a.4.4 0 0 1 .566 0l.424.424a.4.4 0 0 1 0 .566l-3.041 3.041a.7.7 0 0 1-.99 0l-3.04-3.04a.4.4 0 0 1 0-.567l.423-.424a.4.4 0 0 1 .567 0L6 12.876z" />
              </svg>
            </button>
            {showRatioDropdown && (
              <div className="absolute bottom-full right-0 z-50 mb-1 rounded-lg border-[0.5px] border-border bg-card py-1 shadow-card">
                {ASPECT_RATIOS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleAspectRatioChange(r)}
                    className={`flex w-full items-center px-3 py-1.5 text-xs transition-colors hover:bg-muted ${r === aspectRatio ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Generate button */}
          <button
            type="button"
            aria-label="生成图片"
            onClick={() => void handleGenerate()}
            disabled={!prompt.trim() || loading || currentModel?.accessible !== true}
            className="flex h-8 min-w-12 items-center justify-center gap-1 rounded-full bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/80 hover:accent-glow disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          >
            {loading ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
            ) : (
              <svg
                className="h-3.5 w-[9.3px] shrink-0"
                viewBox="0 0 8 10"
                fill="currentColor"
              >
                <path d="M6.9 4.36H5.385V.76c0-.84-.447-1.01-.991-.38L4 .835.677 4.685c-.457.525-.265.955.422.955h1.517v3.6c0 .84.446 1.01.991.38L4 9.165l3.323-3.85c.456-.525.265-.955-.422-.955" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
