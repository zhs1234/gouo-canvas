import { Menu } from '@base-ui/react/menu'
import { EllipsisIcon, SettingsIcon, UserRoundIcon, WalletIcon, ShieldIcon } from 'lucide-react'
import { useAuth } from '../loomic/lib/auth-context'
import { useWorkspaceAccount } from './WorkspaceAccountProvider'
import { useSidebar } from '../chat-starter/components/ui/sidebar'

export function WorkspaceAccountMenu() {
  const { user } = useAuth()
  const { openAccount } = useWorkspaceAccount()
  const { isMobile, setOpenMobile } = useSidebar()
  function open(section: 'profile' | 'billing' | 'security') {
    if (isMobile) setOpenMobile(false)
    openAccount(section, isMobile ? document.querySelector<HTMLElement>('button[aria-label="切换侧栏"]') : document.querySelector<HTMLElement>('.workspace-account-trigger'))
  }
  return <Menu.Root><Menu.Trigger className="workspace-account-trigger" aria-label="New API 账号"><span className="workspace-account-avatar"><UserRoundIcon size={18} aria-hidden="true" /></span><span className="workspace-account-identity"><strong>{user?.display_name || user?.username || '登录账号'}</strong><small>账号与设置</small></span><EllipsisIcon size={18} aria-hidden="true" className="workspace-account-more" /></Menu.Trigger>
    <Menu.Portal><Menu.Positioner side="top" align="start" sideOffset={8} className="workspace-account-positioner"><Menu.Popup className="workspace-account-menu">
      <Menu.Item onClick={() => open('profile')}><SettingsIcon size={16} aria-hidden="true" />{user ? '账号与设置' : '登录账号'}</Menu.Item>
      {user && <Menu.Item onClick={() => open('billing')}><WalletIcon size={16} aria-hidden="true" />余额与用量</Menu.Item>}
      <Menu.Item onClick={() => open('security')}><ShieldIcon size={16} aria-hidden="true" />安全与会话</Menu.Item>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>
}
