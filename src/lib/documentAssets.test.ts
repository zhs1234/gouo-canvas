import { describe, expect, it } from 'vitest'
import { getDocumentImageIds, getLiveDocumentImageIds, registerDocumentImageReferences } from './documentAssets'

describe('跨工作区素材引用', () => {
  it('保护图片节点、多图、Agent 附件和旧会话，忽略文本及临时 URL', () => {
    expect(getDocumentImageIds({ nodes: [{ metadata: { imageId: 'a', references: ['b'], images: [{ storageKey: 'c', content: 'blob:preview' }] } }], messages: [{ referenceImageIds: ['a', 'd'] }], legacy: { inputImageIds: ['e'] }, text: 'f', imageId: 'https://example.com/photo' }).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('撤销记录保护在注销后释放', () => {
    const unregister = registerDocumentImageReferences(() => ['undo-image'])
    expect(getLiveDocumentImageIds().has('undo-image')).toBe(true)
    unregister()
    expect(getLiveDocumentImageIds().has('undo-image')).toBe(false)
  })
})
