import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { CanvasProject } from './types'
import { CanvasNodeType } from './types'
import { createCanvasNode } from './document'

const mocks = vi.hoisted(() => ({ write: vi.fn(), setState: vi.fn() }))
vi.mock('../db', () => ({ hashDataUrl: async () => 'hashed-image', importTaskData: mocks.write }))
vi.mock('../../store', () => ({ ensureImageCached: vi.fn() }))
vi.mock('../../stores/canvasStore', () => ({ useCanvasStore: { setState: mocks.setState }, markCanvasPersisted: vi.fn() }))

import { importCanvasArchive } from './export'

const project: CanvasProject = { id: 'old-project', title: '导入测试', schemaVersion: 1, revision: 5, nodes: [createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { imageId: 'old-image', storageKey: 'old-image', maskImageId: 'old-image', maskTargetImageId: 'old-image', status: 'loading', taskId: 'old-task' })], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', showImageInfo: false, createdAt: 1, updatedAt: 2 }
const archive = (includeImage = true) => new File([zipSync({
  'manifest.json': strToU8(JSON.stringify({ format: 'gouo-canvas', version: 1, projects: [project, { ...project, id: 'second' }], assets: { 'old-image': 'images/0.png' } })),
  ...(includeImage ? { 'images/0.png': new Uint8Array([137, 80, 78, 71]) } : {}),
}) as BlobPart], 'canvas.zip')

let changes: number
beforeEach(() => {
  mocks.write.mockReset()
  mocks.setState.mockReset()
  changes = 0
  const target = new EventTarget()
  target.addEventListener('gouo:documents-changed', () => { changes++ })
  vi.stubGlobal('window', target)
})

describe('画布备份原子导入', () => {
  it('多个项目及图片一次写入，重映射图片与遮罩ID并清除旧任务关联', async () => {
    const result = await importCanvasArchive(archive())
    expect(mocks.write).toHaveBeenCalledTimes(1)
    const [, images, , documents] = mocks.write.mock.calls[0]
    expect(images).toHaveLength(1)
    expect(documents.canvases).toHaveLength(2)
    expect(result[0].id).not.toBe(project.id)
    expect(result[0].nodes[0].metadata).toMatchObject({ imageId: 'hashed-image', maskImageId: 'hashed-image', maskTargetImageId: 'hashed-image', status: 'idle' })
    expect(result[0].nodes[0].metadata?.taskId).toBeUndefined()
    expect(mocks.setState).toHaveBeenCalledTimes(1)
    // 导入后无需再编辑也要触发云同步上传
    expect(changes).toBe(1)
  })

  it('缺少原图时不写入任何数据', async () => {
    await expect(importCanvasArchive(archive(false))).rejects.toThrow('缺少素材')
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.setState).not.toHaveBeenCalled()
  })

  it('事务失败时不把半成功项目发布到界面', async () => {
    mocks.write.mockRejectedValueOnce(new Error('disk quota'))
    await expect(importCanvasArchive(archive())).rejects.toThrow('disk quota')
    expect(mocks.setState).not.toHaveBeenCalled()
    expect(changes).toBe(0)
  })
})
