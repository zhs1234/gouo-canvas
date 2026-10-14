export type BrowserNotificationPermissionResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'insecure' | 'denied' | 'default' | 'error'; error?: unknown }

function getNotificationConstructor() {
  if (typeof window === 'undefined' || !('Notification' in window)) return null
  return window.Notification
}

function isSecureNotificationContext() {
  return typeof window !== 'undefined' && window.isSecureContext
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionResult> {
  const NotificationConstructor = getNotificationConstructor()
  if (!NotificationConstructor) return { ok: false, reason: 'unsupported' }
  if (!isSecureNotificationContext()) return { ok: false, reason: 'insecure' }
  if (NotificationConstructor.permission === 'granted') return { ok: true }
  if (NotificationConstructor.permission === 'denied') return { ok: false, reason: 'denied' }

  try {
    const permission = await window.Notification.requestPermission()
    if (permission === 'granted') return { ok: true }
    if (permission === 'denied') return { ok: false, reason: 'denied' }
    return { ok: false, reason: 'default' }
  } catch (error) {
    return { ok: false, reason: 'error', error }
  }
}

export function showBrowserNotification(title: string, options?: NotificationOptions) {
  const NotificationConstructor = getNotificationConstructor()
  if (!NotificationConstructor || !isSecureNotificationContext() || NotificationConstructor.permission !== 'granted') return false

  try {
    const notification = new NotificationConstructor(title, {
      tag: 'task-completion',
      requireInteraction: false,
      ...options,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch {
    return false
  }
}
