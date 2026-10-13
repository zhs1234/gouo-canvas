// 基于 basketikun/infinite-canvas (MIT)，来源及适配说明见 UPSTREAM.md。
export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const scale = Math.min(1, maxWidth / w, maxHeight / h)
  // 画布节点最小 20，否则小图标、细长横幅放不进画布（校验会拒绝整批插入）
  return { width: Math.max(20, w * scale), height: Math.max(20, h * scale) }
}
