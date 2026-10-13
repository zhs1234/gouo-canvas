import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BRAND } from '../config/brand'
import { editOutputs, reuseConfig, useStore } from '../store'
import { getAllAgentConversations, getAllCanvasProjects } from '../lib/db'
import { INSPIRATION_TEMPLATES } from '../lib/inspirationTemplates'
import { requestUserCenter } from '../lib/userGuidance'
import { useBackendStatus } from '../hooks/useBackendStatus'
import type { AgentConversation, CanvasProject } from '../types'
import Header from './Header'
import InputBar from './InputBar'
import SearchBar from './SearchBar'
import TaskCard from './TaskCard'
import TaskGrid, { confirmRemoveTask } from './TaskGrid'
import { FavoriteCollectionsView } from './favorites/FavoriteCollectionsView'
import { useFavoriteCollectionTitle } from './favorites/useFavoriteCollectionTitle'
import SelectionActions from './input/selectionActions'
import { ChevronLeftIcon, CollectionManageIcon, PlusIcon, SparklesIcon, ChatIcon, FavoriteIcon, EditIcon } from './icons'
import '../workspace.css'

const CanvasWorkspace = lazy(() => import('./canvas/CanvasWorkspace'))
const AgentWorkspace = lazy(() => import('./agent/AgentWorkspace'))
const InspirationLibraryPage = lazy(() => import('./InspirationLibraryModal').then((module) => ({ default: module.InspirationLibraryPage })))
const canvasBuildEnabled = import.meta.env.VITE_CANVAS_ENABLED !== 'false'
const agentBuildEnabled = import.meta.env.VITE_AGENT_ENABLED !== 'false'

// 构建开关是上限，后台“光构设置”可在此基础上随时关闭画布或 Agent
function useCreationFeatures() {
  const status = useBackendStatus()
  const canvasEnabled = canvasBuildEnabled && status?.gouo_canvas_enabled !== false
  const agentEnabled = agentBuildEnabled && status?.gouo_agent_enabled !== false
  const creationModes = [{ id: 'generate', label: '生成图片', enabled: true }, { id: 'canvas', label: '画布', enabled: canvasEnabled }, { id: 'agent', label: 'Agent', enabled: agentEnabled }].filter((item) => item.enabled)
  return { canvasEnabled, agentEnabled, creationModes }
}
const NOTICE_DISMISSED_KEY = 'gouo-canvas.notice-dismissed'

// 服务端邮件和支付返回的链接指向 /topup，打开用户中心的充值页
function TopupRoute() {
  useEffect(() => { requestUserCenter('topup') }, [])
  return <Navigate to="/generate" replace />
}

function CanvasRoute() {
  const { id } = useParams()
  const { agentEnabled } = useCreationFeatures()
  const navigate = useNavigate()
  const [drawer, setDrawer] = useState(false)
  const [conversationId, setConversationId] = useState<string>()
  const openAgent = async (projectId: string) => {
    const conversations = await getAllAgentConversations()
    setConversationId(conversations.filter((item) => item.projectId === projectId && !item.hiddenAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id)
    setDrawer(true)
  }
  return <div className="canvas-route">
    <CanvasWorkspace projectId={id} onOpenProject={(next) => { setDrawer(false); navigate(`/canvas/${encodeURIComponent(next)}`) }} onOpenAgent={agentEnabled ? (projectId) => void openAgent(projectId) : undefined} />
    {drawer && id && agentEnabled && <aside className="canvas-agent-drawer" aria-label="画布 Agent"><div className="canvas-agent-drawer-heading"><span>创作助手</span><button onClick={() => navigate(conversationId ? `/agent/${conversationId}` : `/agent?canvas=${id}`)}>展开会话 ↗</button><button aria-label="关闭画布 Agent" onClick={() => setDrawer(false)}>×</button></div><AgentWorkspace embedded projectId={id} conversationId={conversationId} onOpenConversation={setConversationId} /></aside>}
  </div>
}

function AgentRoute() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  return <AgentWorkspace conversationId={id} projectId={new URLSearchParams(location.search).get('canvas') || undefined} onOpenConversation={(next) => navigate(`/agent/${encodeURIComponent(next)}`)} />
}

// 本次进入创作页后提交的任务直接显示在输入框下方，不用去「我的作品」找
function RecentResults() {
  const [since] = useState(() => Date.now())
  const tasks = useStore((s) => s.tasks)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const recent = tasks.filter((task) => (task.createdAt >= since || task.status === 'running') && (task.source?.kind ?? 'generate') === 'generate').sort((a, b) => b.createdAt - a.createdAt).slice(0, 6)
  if (!recent.length) return null
  return <section className="recent-results" aria-label="本次生成">
    <div className="section-label">本次生成<span><Link to="/works">全部作品 ↗</Link></span></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recent.map((task) => <TaskCard key={task.id} task={task} onClick={() => setDetailTaskId(task.id)} onReuse={() => reuseConfig(task)} onEditOutputs={() => editOutputs(task)} onDelete={() => confirmRemoveTask(task)} />)}
    </div>
  </section>
}

function GenerateWorkspace({ mode, setMode }: { mode: string; setMode: (mode: string) => void }) {
  const { creationModes, agentEnabled } = useCreationFeatures()
  const location = useLocation()
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const [category, setCategory] = useState('精选')
  const [projectId, setProjectId] = useState<string>()
  const [agentProjectId, setAgentProjectId] = useState<string>()
  const [conversationId, setConversationId] = useState<string>()
  const rememberConversation = useCallback((id: string) => setConversationId((current) => current || id), [])
  useLayoutEffect(() => {
    setMode('generate')
    window.scrollTo(0, 0)
  }, [location.key, setMode])
  // 后台关闭了当前模式时回到生成图片
  const modeIds = creationModes.map((item) => item.id).join()
  useEffect(() => {
    if (!modeIds.split(',').includes(mode)) setMode('generate')
  }, [modeIds, mode, setMode])
  const openAgent = async (id: string) => {
    try {
      const conversations = await getAllAgentConversations()
      setConversationId(conversations.filter((item) => item.projectId === id && !item.hiddenAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id)
      setAgentProjectId(id)
      setMode('agent')
    } catch (err) {
      console.warn('打开画布会话失败', err)
      useStore.getState().showToast('无法打开画布会话，请重试', 'error')
    }
  }
  const templates = INSPIRATION_TEMPLATES.filter((item) => category === '精选' || item.tags.some((tag) => tag.includes(category)) || item.category.includes(category))
  const applyTemplate = (text: string) => {
    if (prompt.trim()) {
      useStore.getState().setConfirmDialog({ title: '替换当前提示词？', message: '已有的提示词将被所选模板替换，参考图片会保留。', confirmText: '使用模板', action: () => setPrompt(text) })
    } else setPrompt(text)
    document.querySelector('[data-input-bar]')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' })
  }
  return <main data-home-main className="generate-workspace">
    <section className="creation-hero" aria-labelledby="creation-heading">
      <h1 id="creation-heading">天马行空，尽情创作</h1>
      <div className="workspace-modes" role="tablist" aria-label="创作方式">
        <span className="workspace-mode-indicator" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${creationModes.length})`, transform: `translateX(${creationModes.findIndex((item) => item.id === mode) * 100}%)` }} />
        {creationModes.map((item, index) => <button key={item.id} type="button" role="tab" id={`mode-${item.id}`} aria-selected={mode === item.id} aria-controls={`panel-${item.id}`} tabIndex={mode === item.id ? 0 : -1} onClick={() => setMode(item.id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? creationModes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + creationModes.length) % creationModes.length
          setMode(creationModes[next].id)
          document.getElementById(`mode-${creationModes[next].id}`)?.focus()
        }}>{item.label}</button>)}
      </div>
    </section>
    {creationModes.map((item) => <div key={item.id} id={`panel-${item.id}`} role="tabpanel" aria-labelledby={`mode-${item.id}`} hidden={mode !== item.id} className={`workspace-mode-panel workspace-panel-${item.id}`}>
      {mode === item.id && <Suspense fallback={<div className="workspace-loading" role="status">正在打开创作空间…</div>}>
        {item.id === 'generate' && <>
          <div className="creation-composer">
            <div className="creation-input"><div className="composer-heading"><SparklesIcon className="h-4 w-4" /> AI 图像<span>从一个想法开始</span></div><InputBar inline /></div>
            <div className="prompt-shortcuts">{INSPIRATION_TEMPLATES.slice(0, 6).map((item) => <button key={item.id} onClick={() => applyTemplate(item.prompt)}>/ {item.title}</button>)}</div>
          </div>
          <RecentResults />
          <section className="inspiration-strip" aria-label="灵感精选">
            <div className="section-label">灵感精选<span>让想法有迹可循</span></div>
            <div className="inspiration-cards">{[3, 4, 7, 10].map((index) => INSPIRATION_TEMPLATES[index]).filter(Boolean).map((item) => <button key={item.id} className="inspiration-card" onClick={() => applyTemplate(item.prompt)}>
              <img src={`${import.meta.env.BASE_URL}${item.previewImage}`} alt={item.title} loading="lazy" />
              <span className="inspiration-caption"><strong>{item.title}</strong><small>{item.description}</small></span>
            </button>)}</div>
            <div className="inspiration-categories">{['精选', '商业', '海报', '写实', '设计', '插画'].map((item) => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <div className="template-links">{templates.slice(0, 5).map((item) => <button key={item.id} onClick={() => applyTemplate(item.prompt)}>{item.title}<span>↗</span></button>)}{templates.length === 0 && <span>此分类暂无模板，可从精选中寻找灵感。</span>}</div>
          </section>
        </>}
        {item.id === 'canvas' && <CanvasWorkspace projectId={projectId} onOpenProject={setProjectId} onOpenAgent={agentEnabled ? (id) => void openAgent(id) : undefined} />}
        {item.id === 'agent' && <AgentWorkspace conversationId={conversationId} projectId={agentProjectId} onOpenConversation={setConversationId} onConversationReady={rememberConversation} />}
      </Suspense>}
    </div>)}
  </main>
}

function WorksWorkspace() {
  const navigate = useNavigate()
  return <main className="library-page" aria-labelledby="works-heading">
    <header className="library-page-heading"><h1 id="works-heading">我的作品</h1><p>查看生成进度，管理作品，继续创作。</p></header>
    <section data-drag-select-surface aria-label="作品列表">
      <SearchBar onToggleFavorites={() => navigate('/favorites')} />
      <TaskGrid />
    </section>
    <SelectionActions inline />
  </main>
}

function FavoritesWorkspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const collection = useStore((s) => s.activeFavoriteCollectionId)
  const title = useFavoriteCollectionTitle()
  useEffect(() => {
    const state = useStore.getState()
    state.setActiveFavoriteCollectionId(null)
    state.setSearchQuery('')
    state.setFilterStatus('all')
  }, [location.key])
  return <main className="library-page" aria-labelledby="favorites-heading">
    <header className="library-page-heading"><h1 id="favorites-heading">{title || '收藏'}</h1><p>{collection ? '收藏的作品，随时继续创作。' : '把喜欢的作品整理在一起，留住每一次灵感。'}</p></header>
    <section data-drag-select-surface aria-label="收藏作品">
      <SearchBar onToggleFavorites={() => navigate('/works')} />
      {collection ? <TaskGrid /> : <FavoriteCollectionsView />}
    </section>
    <SelectionActions inline />
  </main>
}

export default function Workspace() {
  const { canvasEnabled, agentEnabled } = useCreationFeatures()
  const location = useLocation()
  const navigate = useNavigate()
  const favorite = location.pathname === '/favorites'
  const inspiration = location.pathname === '/inspiration'
  const works = location.pathname === '/works'
  const [mode, setMode] = useState('generate')
  const canvas = location.pathname === '/canvas' || location.pathname.startsWith('/canvas/') || (location.pathname === '/generate' && mode === 'canvas')
  const [collapsed, setCollapsed] = useState(false)
  const [canvasExpanded, setCanvasExpanded] = useState(false)
  const [projects, setProjects] = useState<CanvasProject[]>([])
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [banner, setBanner] = useState(true)
  const notice = useBackendStatus()?.gouo_notice?.trim() || ''
  // 后台公告被关闭后记住内容，公告更新时再显示；默认介绍只在本次打开期间关闭
  const [dismissedNotice, setDismissedNotice] = useState(() => {
    try {
      return localStorage.getItem(NOTICE_DISMISSED_KEY) || ''
    } catch {
      return ''
    }
  })
  const showBanner = notice ? dismissedNotice !== notice : banner
  const closeBanner = () => {
    if (!notice) return setBanner(false)
    setDismissedNotice(notice)
    try {
      localStorage.setItem(NOTICE_DISMISSED_KEY, notice)
    } catch (err) {
      console.warn('记录公告关闭状态失败', err)
    }
  }
  const narrow = canvas ? !canvasExpanded : collapsed
  useLayoutEffect(() => { setCanvasExpanded(false) }, [canvas, location.key])
  useLayoutEffect(() => {
    const state = useStore.getState()
    state.setFilterFavorite(favorite)
    state.setSearchQuery('')
    state.setFilterStatus('all')
  }, [favorite, location.key])
  useEffect(() => {
    const openCreation = () => navigate('/generate')
    window.addEventListener('gouo:open-creation', openCreation)
    return () => window.removeEventListener('gouo:open-creation', openCreation)
  }, [navigate])
  useEffect(() => {
    let active = true
    const refresh = () => { void Promise.all([getAllCanvasProjects(), getAllAgentConversations()]).then(([nextProjects, nextConversations]) => { if (active) { setProjects(nextProjects); setConversations(nextConversations) } }).catch((err) => console.warn('加载工作区记录失败', err)) }
    refresh()
    window.addEventListener('gouo:documents-changed', refresh)
    return () => { active = false; window.removeEventListener('gouo:documents-changed', refresh) }
  }, [])
  useEffect(() => { document.documentElement.classList.add('dark'); window.scrollTo(0, 0) }, [location.key])
  // 浏览器后退等切换页面时，收藏夹选择窗口不应留在新页面上
  useEffect(() => { useStore.getState().closeFavoritePicker() }, [location.pathname])
  return <div className={`workspace-shell ${narrow ? 'sidebar-collapsed' : ''} ${canvas ? 'canvas-mode' : ''} ${location.pathname.startsWith('/agent') ? 'agent-mode-page' : ''}`}>
    {showBanner && location.pathname === '/generate' && !canvas && <div className="workspace-announcement">{notice ? <><span>公告</span> {notice}</> : <><span>光构创作空间</span> 把灵感构造成图像 · 生成、画布与 Agent，一处完成</>}<button aria-label="关闭提示" onClick={closeBanner}>×</button></div>}
    <aside className="workspace-sidebar" aria-label="主导航">
      <Link to="/generate" className="workspace-brand" aria-label="光构首页"><img src={BRAND.logoUrl} alt="" /><strong>{BRAND.name}<small>Gouo Canvas</small></strong></Link>
      <button className="sidebar-toggle" aria-label={narrow ? '展开导航' : '收起导航'} onClick={() => canvas ? setCanvasExpanded(narrow) : setCollapsed(!narrow)}><ChevronLeftIcon className="h-4 w-4" /></button>
      <nav>
        <Link title="创作" to="/generate" className={!favorite && !inspiration && !works ? 'active' : ''} aria-current={!favorite && !inspiration && !works ? 'page' : undefined}><EditIcon className="h-5 w-5" /><span>创作</span></Link>
        <Link title="我的作品" to="/works" className={works ? 'active' : ''} aria-current={works ? 'page' : undefined}><CollectionManageIcon className="h-5 w-5" /><span>我的作品</span></Link>
        <Link title="收藏" to="/favorites" className={favorite ? 'active' : ''} aria-current={favorite ? 'page' : undefined}><FavoriteIcon className="h-5 w-5" /><span>收藏</span></Link>
        <Link title="灵感库" to="/inspiration" className={inspiration ? 'active' : ''} aria-current={inspiration ? 'page' : undefined}><SparklesIcon className="h-5 w-5" /><span>灵感库</span></Link>
      </nav>
      <div className="sidebar-records"><div className="sidebar-section-title">创作会话{agentEnabled && <Link to="/agent" aria-label="新会话"><PlusIcon className="h-4 w-4" /></Link>}</div>
        {agentEnabled && conversations.filter((item) => !item.hiddenAt && (item.messages.length || item.draft.trim())).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((item) => <Link className={location.pathname.endsWith(item.id) ? 'active' : ''} key={item.id} to={`/agent/${item.id}`}><ChatIcon className="h-4 w-4" /><span>{item.title}</span></Link>)}
        {!conversations.some((item) => !item.hiddenAt && (item.messages.length || item.draft.trim())) && <p>你的对话会显示在这里</p>}
        <div className="sidebar-section-title">我的画布{canvasEnabled && <Link to="/canvas" aria-label="画布项目"><PlusIcon className="h-4 w-4" /></Link>}</div>
        {canvasEnabled && projects.filter((item) => !item.hiddenAt).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((item) => <Link key={item.id} to={`/canvas/${item.id}`}><CollectionManageIcon className="h-4 w-4" /><span>{item.title}</span></Link>)}
        {!projects.some((item) => !item.hiddenAt) && <p>把灵感铺开，开始第一块画布</p>}
      </div>
    </aside>
    <div className="workspace-main"><Header compact /><Suspense fallback={<div className="workspace-loading" role="status">正在打开创作空间…</div>}><Routes>
      <Route path="/generate" element={<GenerateWorkspace mode={mode} setMode={setMode} />} />
      <Route path="/works" element={<WorksWorkspace />} />
      <Route path="/favorites" element={<FavoritesWorkspace />} />
      <Route path="/topup" element={<TopupRoute />} />
      <Route path="/inspiration" element={<InspirationLibraryPage onApply={() => navigate('/generate')} />} />
      {canvasEnabled && <Route path="/canvas/:id?" element={<CanvasRoute />} />}
      {agentEnabled && <Route path="/agent/:id?" element={<AgentRoute />} />}
      <Route path="*" element={<Navigate to="/generate" replace />} />
    </Routes></Suspense></div>
  </div>
}
