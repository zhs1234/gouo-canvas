import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTooltip } from '../hooks/useTooltip'
import ViewportTooltip from './ViewportTooltip'

// 侧栏导航项；侧栏收成图标栏时文字被隐藏，改用悬停提示显示名称
export default function WorkspaceNavItem({ to, label, icon, active = false, collapsed, className = '', onClick, onPreload }: {
  to?: string
  label: string
  icon: ReactNode
  active?: boolean
  collapsed: boolean
  className?: string
  onClick?: () => void
  onPreload?: () => void
}) {
  const tooltip = useTooltip()
  const props = {
    className: `${active ? 'active' : ''} ${className}`.trim() || undefined,
    'aria-label': collapsed ? label : undefined,
    onPointerEnter: onPreload,
    ...(collapsed ? tooltip.handlers : {}),
    onClick: () => {
      tooltip.dismiss()
      onClick?.()
    },
  }
  const content = <>
    {icon}<span>{label}</span>
    {collapsed && <ViewportTooltip visible={tooltip.visible} className="whitespace-nowrap">{label}</ViewportTooltip>}
  </>
  if (!to) return <button type="button" {...props}>{content}</button>
  return <Link to={to} aria-current={active ? 'page' : undefined} {...props}>{content}</Link>
}
