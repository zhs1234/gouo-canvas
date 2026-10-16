import { BRAND } from '../config/brand'

const PAGE_NAMES = {
  generate: '创作',
  works: '我的作品',
  favorites: '收藏',
  inspiration: '灵感库',
  canvas: '我的画布',
  agent: 'Agent',
  topup: '充值',
}

export type WorkspacePage = keyof typeof PAGE_NAMES

// 按路径判断当前页面，和 Workspace 的路由表保持一致；未知或已关闭的页面返回 undefined（显示 404）
export function getWorkspacePage(pathname: string, features: { canvasEnabled: boolean; agentEnabled: boolean }) {
  const parts = pathname.split('/').filter(Boolean)
  const page = parts[0] as WorkspacePage | undefined
  if (!page || !Object.keys(PAGE_NAMES).includes(page)) return undefined
  if (page === 'canvas' && !features.canvasEnabled) return undefined
  if (page === 'agent' && !features.agentEnabled) return undefined
  if (parts.length > (page === 'canvas' || page === 'agent' ? 2 : 1)) return undefined
  return page
}

// 浏览器标签页标题：具体对象（画布名、会话名、收藏夹名）优先，其次是页面名
export function getPageTitle(page: WorkspacePage | undefined, detail = '') {
  return `${detail.trim() || (page ? PAGE_NAMES[page] : '页面不存在')} · ${BRAND.name}`
}
