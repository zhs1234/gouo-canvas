import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FolderIcon, MessagesSquare, PanelsTopLeftIcon, PencilRuler, UserIcon } from 'lucide-react'
import { useAuth } from '../loomic/lib/auth-context'
import { ThreadListSidebar } from '../chat-starter/components/assistant-ui/elements/threadlist-sidebar.aui'
import { SidebarInset, SidebarProvider, SidebarTrigger, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../chat-starter/components/ui/sidebar'
import { Separator } from '../chat-starter/components/ui/separator'
import '../chat-starter/theme.css'
import './workspace.css'

function CloseDrawerAfterNavigation() {
  const { pathname, search, hash } = useLocation()
  const { setOpenMobile } = useSidebar()
  useEffect(() => { setOpenMobile(false) }, [pathname, search, hash, setOpenMobile])
  return null
}

function WorkspaceNavigation() {
  const { pathname } = useLocation()
  const items = [{ path: '/chat', label: '聊天', icon: MessagesSquare, active: pathname === '/' || pathname === '/chat' },
    { path: '/canvas-lab', label: '画布', icon: PanelsTopLeftIcon, active: pathname === '/canvas-lab' },
    { path: '/projects', label: '项目库', icon: FolderIcon, active: pathname === '/projects' },
    { path: '/canvas', label: 'Loomic 工作台', icon: PencilRuler, active: pathname === '/canvas' }]
  return <nav aria-label="主导航" className="workspace-navigation"><SidebarMenu>{items.map(item => <SidebarMenuItem key={item.path}><SidebarMenuButton isActive={item.active} aria-current={item.active ? 'page' : undefined} render={<Link to={item.path} />}><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></nav>
}

export function WorkspaceShell({ list, toolbar, title, footer, notice, children }: { list?: ReactNode; toolbar?: ReactNode; title?: string; footer?: ReactNode; notice?: ReactNode; children: ReactNode }) {
  const { user } = useAuth()
  const defaultFooter = <SidebarMenu><SidebarMenuItem><SidebarMenuButton render={<Link to="/chat" />}><UserIcon /><span>{user?.display_name || user?.username || '登录账号'}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
  return <SidebarProvider className="chat-starter workspace-shell"><CloseDrawerAfterNavigation /><div className="flex h-dvh min-h-0 min-w-0 w-full pr-0.5"><ThreadListSidebar footer={footer ?? defaultFooter}><WorkspaceNavigation />{list}</ThreadListSidebar><SidebarInset className="min-h-0 min-w-0"><header className={`workspace-header flex shrink-0 items-center gap-2 px-4 ${toolbar ? 'h-16 border-b' : 'h-10'}`}><SidebarTrigger aria-label="切换侧栏" />{toolbar ? <><Separator orientation="vertical" className="mr-2 h-4" />{toolbar}</> : <span className="sr-only">{title}</span>}</header>{notice}<div className="workspace-content flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div></SidebarInset></div></SidebarProvider>
}
