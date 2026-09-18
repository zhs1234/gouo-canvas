import { lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Notice, Panel } from '@gouo/ui'
import Account from './Account'
import Models from './Models'
const Editor = lazy(() => import('./Editor'))
export default function App() {
  return <div className="layout">
    <aside><a className="brand" href="/studio/">GOUO <span>STUDIO / V2</span></a>
      <nav aria-label="工作台导航"><NavLink to="/" end>工作台</NavLink><NavLink to="/editor">本地编辑器</NavLink><NavLink to="/models">模型接入清单</NavLink></nav>
      <p className="aside-note">电商图片工作流<br />新业务，复用成熟基础设施</p>
    </aside>
    <main><header><p className="eyebrow">DEVELOPMENT FOUNDATION</p><h1>商品创作工作台</h1></header>
      <Notice>开发起点：已接入编辑引擎与账号接口；AI 任务、项目云保存、订阅尚待开发，不是可收费的完整产品。</Notice>
      <Suspense fallback={<p role="status">正在加载编辑器…</p>}><Routes>
        <Route path="/" element={<div className="grid"><Panel title="本次开发目标"><p>上传商品 → 选择场景 → AI 生成 → 编辑 → 保存 → 导出。</p><p>先完成服务端任务与模型验证，再开放真实生成。任务顺序见 docs/v2/TASKS.md。</p><NavLink className="button" to="/editor">打开本地编辑器</NavLink></Panel><Account /></div>} />
        <Route path="/editor" element={<Editor />} /><Route path="/models" element={<Models />} /><Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
    </main>
  </div>
}
