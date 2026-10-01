// The pinned Native account UI is a separate SPA. Keep authentication there,
// then load Studio as a document instead of routing it inside Native's router.
(() => {
  const authPaths = new Set(['/sign-in', '/sign-up', '/register'])
  const isStudio = path => path === '/studio' || path.startsWith('/studio/')
  const normalized = url => { if (url.pathname === '/studio') url.pathname = '/studio/'; return url.href }
  const originalPush = history.pushState.bind(history)
  const originalReplace = history.replaceState.bind(history)
  const initial = new URL(location.href)
  if (authPaths.has(initial.pathname) && !initial.searchParams.has('redirect')) {
    initial.searchParams.set('redirect', '/studio/')
    originalReplace(history.state, '', initial.href)
  }
  const requested = initial.searchParams.get('redirect')
  let studioTarget
  try {
    const target = new URL(requested || '', location.origin)
    if (requested && target.origin === location.origin && isStudio(target.pathname)) studioTarget = target.pathname === '/studio' ? '/studio/' + target.search + target.hash : target.pathname + target.search + target.hash
  } catch {}
  function change(original, replace, state, title, value) {
    if (value != null) {
      const destination = new URL(String(value), location.href)
      if (destination.origin === location.origin && isStudio(destination.pathname)) {
        location[replace ? 'replace' : 'assign'](normalized(destination)); return
      }
      if (studioTarget && destination.origin === location.origin && authPaths.has(destination.pathname) && destination.pathname !== location.pathname) {
        destination.searchParams.set('redirect', studioTarget)
        location[replace ? 'replace' : 'assign'](destination.href); return
      }
    }
    original(state, title, value)
  }
  history.pushState = (state, title, value) => change(originalPush, false, state, title, value)
  history.replaceState = (state, title, value) => change(originalReplace, true, state, title, value)
  document.addEventListener('click', event => {
    if (!studioTarget || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return
    const destination = new URL(anchor.href)
    if (destination.origin !== location.origin || !authPaths.has(destination.pathname)) return
    destination.searchParams.set('redirect', studioTarget)
    event.preventDefault(); event.stopImmediatePropagation(); location.assign(destination.href)
  }, true)
})()
