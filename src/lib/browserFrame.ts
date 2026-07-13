export function isEmbeddedPage() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
