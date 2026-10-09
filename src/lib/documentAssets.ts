const referenceKeys = new Set(['references', 'imageId', 'imageIds', 'referenceImageIds', 'inputImageIds', 'outputImages', 'maskImageId', 'maskTargetImageId', 'storageKey', 'transparentOriginalImages', 'streamPartialImageIds'])
const providers = new Set<() => Iterable<string>>()

// 旧版会话也参与引用保护；无法识别的文档保留原样，不能被素材清理误伤。
export function getDocumentImageIds(value: unknown): string[] {
  const ids = new Set<string>()
  function visit(item: unknown, key = '') {
    if (typeof item === 'string') {
      if (referenceKeys.has(key) && item && !/^(data:|blob:|https?:)/i.test(item)) ids.add(item)
      return
    }
    if (Array.isArray(item)) { for (const child of item) visit(child, key); return }
    if (item && typeof item === 'object') {
      for (const [name, child] of Object.entries(item)) visit(child, name)
    }
  }
  visit(value)
  return [...ids]
}

export function registerDocumentImageReferences(provider: () => Iterable<string>) {
  providers.add(provider)
  return () => { providers.delete(provider) }
}

export function getLiveDocumentImageIds() {
  return new Set([...providers].flatMap((provider) => [...provider()]))
}
