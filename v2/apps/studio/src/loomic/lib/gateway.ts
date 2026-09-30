export type GatewayModel = {
  id: string; displayName: string; kind: 'chat' | 'image' | 'video'; accessible: boolean;
  description: string; provider: string; qualities?: string[]; aspectRatios?: string[];
  operations?: Array<'generate' | 'edit'>;
}
export type GatewayCatalog = { models: GatewayModel[]; generationEnabled: boolean; conversationMode?: 'agent' | 'image' | 'unavailable' }
export async function fetchCatalog(): Promise<GatewayCatalog> {
  const response = await fetch('/api/studio/models', { credentials: 'include', cache: 'no-store', redirect: 'error' })
  const body = await response.json()
  if (!response.ok || body.success !== true) throw new Error(body.message || '无法加载模型目录')
  return body.data
}
