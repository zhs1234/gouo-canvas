import { createContext, lazy, useContext, useState, type ComponentProps, type ComponentType } from 'react'

const RetryContext = createContext(() => {})

// 页面骨架：标题、说明和内容块，与作品页、灵感库、画布列表的布局大致一致
export function PageSkeleton() {
  return <div className="page-skeleton" role="status" aria-label="正在加载页面">
    <span className="page-skeleton-title" />
    <span className="page-skeleton-line" />
    <div className="page-skeleton-grid">{Array.from({ length: 8 }, (_, idx) => <span key={idx} />)}</div>
  </div>
}

function PageLoadFailed() {
  const retry = useContext(RetryContext)
  return <div className="page-load-failed" role="alert">
    <strong>页面加载失败</strong>
    <p>网络不稳定或站点刚刚更新，请检查网络后重试。</p>
    <button type="button" onClick={retry}>重试</button>
  </div>
}

// 懒加载的页面模块下载失败（断网、发版后旧文件失效）时显示重试，而不是让整页报错；重试会重新发起 import
// 组件类型约束与 React.lazy 一致，接受任意 props
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let retried = false
  const create = () => lazy(() => load().catch((err) => {
    console.warn('页面模块加载失败', err)
    // 部分浏览器会记住失败的模块请求，原地重试仍失败时刷新页面重新获取（发版后旧文件失效也靠刷新恢复）
    if (retried) window.location.reload()
    return { default: PageLoadFailed as unknown as T }
  }))
  let Page = create()
  function LazyPage(props: ComponentProps<T>) {
    const [, setAttempt] = useState(0)
    const retry = () => {
      retried = true
      Page = create()
      setAttempt((n) => n + 1)
    }
    return <RetryContext.Provider value={retry}><Page {...props} /></RetryContext.Provider>
  }
  // 悬停导航时提前下载，点进去时通常已就绪
  LazyPage.preload = () => { load().catch(() => {}) }
  return LazyPage
}
