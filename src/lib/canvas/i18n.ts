import zhCN from './zhCN'

// 画布只有中文一种语言，按路径取文案并替换 {{name}} 插值；找不到时与 i18next 一样返回 key。
export function t(key: string, vars?: Record<string, unknown>) {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], zhCN)
  if (typeof value !== 'string') return key
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match))
}

// 保留 react-i18next 的调用形状，组件里无需改动。
export function useTranslation() {
  return { t }
}
