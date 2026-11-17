const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

function isInsideCanvas(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.canvas-workspace'))
}

export function installMobileViewportGuards() {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewport) viewport.content = VIEWPORT_CONTENT

  // 页面本身允许缩放。画布上的双指交给画布自己处理，避免浏览器把整页一起放大。
  const preventPageGesture = (event: Event) => {
    if (isInsideCanvas(event.target)) event.preventDefault()
  }

  const preventMultiTouchPageZoom = (event: TouchEvent) => {
    if (event.touches.length > 1 && isInsideCanvas(event.target)) event.preventDefault()
  }

  document.addEventListener('gesturestart', preventPageGesture, { passive: false })
  document.addEventListener('gesturechange', preventPageGesture, { passive: false })
  document.addEventListener('touchmove', preventMultiTouchPageZoom, { passive: false })
}
