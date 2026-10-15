export type UserCenterSection = 'overview' | 'topup' | 'logs' | 'security'

export const EMPTY_GALLERY_PROMPTS = [
  { title: '电影感人像', prompt: '一位年轻创意工作者站在雨后的城市街角，蓝调时刻，35mm 电影摄影，路面反射暖色店铺灯光，人物姿态自然，真实皮肤纹理，浅景深，不要文字和水印。' },
  { title: '高级产品图', prompt: '一只无品牌的磨砂玻璃香水瓶放在深色石材台面，侧后方柔光勾勒轮廓，少量水汽和克制倒影，高端商业产品摄影，背景干净，标签区域留白。' },
  { title: '极简海报', prompt: '设计一张当代艺术展览海报，象牙白背景，深蓝几何图形与一处亮橙强调，严格网格、大面积留白，保留标题和日期区域但不要生成具体文字，细腻丝网印刷颗粒。' },
  { title: '纸雕插画', prompt: '多层纸雕风格的春日山谷，一列小火车穿过拱桥，前景花草、中景树林、远景云朵，纸张纤维清晰，柔和层间阴影，清新配色，精致童话感。' },
  { title: '温暖室内', prompt: '现代暖调极简客厅，浅橡木地板、米色沙发、深色雕塑茶几和自然绿植，午后阳光穿过落地窗，真实建筑摄影，空间宜居、线条端正、陈设克制。' },
  { title: '知识图解', prompt: '竖版三步知识图解，主题是从灵感到成品，依次表现想法、草图和完成作品，象牙白、深蓝与亮橙配色，清晰信息层级，预留文字区域但不要生成具体文字。' },
]

export function requestUserCenter(section: UserCenterSection = 'overview') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<UserCenterSection>('gouo:open-user-center', { detail: section }))
}

export function isBalanceError(message: string) {
  return /余额不足|额度不足|积分不足|配额不足|insufficient\s+(balance|quota|credit)|not enough\s+(balance|quota|credit)/i.test(message)
}

export function getActionableErrorMessage(message: string, billedRequest = false) {
  const normalized = message.trim() || '请求失败'
  if (/下一步[:：]/.test(normalized)) return normalized
  if (isBalanceError(normalized)) return `${normalized}\n下一步：打开用户中心兑换积分，然后点击任务上的“重试”。`
  // 平台内容审查在扣费前拦截，不需要核对账务
  if (normalized.includes('提示词包含不允许的内容')) return `${normalized}\n下一步：修改提示词中不合适的描述后重新生成；这次请求已被拦下，没有扣费。`
  if (/安全系统|safety|sexual|violence|content policy|内容审核/i.test(normalized)) return `${normalized}\n下一步：删除可能涉及敏感内容的描述，明确人物为成年人且穿着完整，再重新生成。`
  if (/无效的令牌|token.+(invalid|expired)|unauthorized|HTTP\s*401/i.test(normalized)) return `${normalized}\n下一步：重新登录以刷新生成令牌；提示词和参考图草稿会保留。`
  if (billedRequest) return `${normalized}\n下一步：没有返回图片的请求会自动退回积分，可在使用记录的积分明细中查看；原请求如果其实已经生成，可在任务详情点“取回结果”免费取回。点击任务上的“重试”会新建付费请求，多张图片分别计费。`
  if (/network|fetch|连接|超时|timeout|ECONN|Failed to fetch/i.test(normalized)) return `${normalized}\n下一步：检查网络连接，稍后点击任务上的“重试”；不要重复快速提交。`
  if (/too large|文件过大|不能超过 \d+\s*MB|payload/i.test(normalized)) return `${normalized}\n下一步：压缩参考图或改用 JPEG/WebP 后重新上传。`
  if (/格式|decode|解码|unsupported.*image/i.test(normalized)) return `${normalized}\n下一步：将图片转换成 PNG、JPEG 或 WebP，再重新上传。`
  return `${normalized}\n下一步：可先点击任务详情中的“复制完整报错”，然后重试；若仍失败，请把 request ID 提供给管理员。`
}
