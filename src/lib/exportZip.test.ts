import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import type { AppSettings, StoredImage, StoredImageThumbnail, TaskParams, TaskRecord } from '../types'
import { buildExportZip, readExportZip, readExportZipFileAsDataUrl, unzipWithLimits } from './exportZip'

describe('exportZip', () => {
  it('rejects oversized entries before inflating and skips unexpected files', () => {
    const manifest = strToU8(JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), tasks: [] }))
    // 高压缩比的"压缩炸弹"：压缩后很小，声明的解压体积很大
    const bomb = zipSync({ 'manifest.json': manifest, 'images/big.png': new Uint8Array(2 * 1024 * 1024) })
    expect(bomb.length).toBeLessThan(64 * 1024)
    const opts = { maxEntry: 1024 * 1024, maxTotal: 4 * 1024 * 1024, allow: (name: string) => name === 'manifest.json' || name.startsWith('images/') }
    expect(() => unzipWithLimits(bomb, opts)).toThrow('解压后的备份过大')
    const many = zipSync({ 'manifest.json': manifest, 'images/a.png': new Uint8Array(900 * 1024), 'images/b.png': new Uint8Array(900 * 1024), 'images/c.png': new Uint8Array(900 * 1024), 'images/d.png': new Uint8Array(900 * 1024), 'images/e.png': new Uint8Array(900 * 1024) })
    expect(() => unzipWithLimits(many, opts)).toThrow('解压后的备份过大')
    const extra = zipSync({ 'manifest.json': manifest, 'other/huge.bin': new Uint8Array(8 * 1024 * 1024), '../escape.png': new Uint8Array(1) })
    expect(Object.keys(unzipWithLimits(extra, opts))).toEqual(['manifest.json'])
    expect(Object.keys(readExportZip(extra).files)).toEqual(['manifest.json'])
  })

  it('rejects malformed, unsupported, or incomplete backups before import', () => {
    const base = { version: 3, exportedAt: new Date().toISOString(), tasks: [], imageFiles: {} }
    for (const data of [null, { ...base, version: 99 }, { ...base, tasks: {} }, { ...base, tasks: [{ id: 'broken' }] }, { ...base, imageFiles: { missing: { path: 'images/missing.png' } } }]) {
      expect(() => readExportZip(zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) }))).toThrow()
    }
    expect(() => readExportZip(zipSync({ 'manifest.json': strToU8('{') }))).toThrow()
    expect(readExportZip(zipSync({ 'manifest.json': strToU8(JSON.stringify({ ...base, version: 2 })) })).manifest.version).toBe(2)
    const task = { id: 'test', prompt: '', params: {}, inputImageIds: [], outputImages: ['missing'], status: 'done', createdAt: 1 }
    expect(() => readExportZip(zipSync({ 'manifest.json': strToU8(JSON.stringify({ ...base, tasks: [task] })) }))).toThrow('缺少原图')
  })
  it('builds and reads backup zip entries without changing manifest shape', () => {
    const task: TaskRecord = {
      id: 'task-1',
      prompt: '提示词',
      params: {} as TaskParams,
      inputImageIds: ['img-1'],
      outputImages: ['img-2'],
      streamPartialImageIds: ['img-3'],
      status: 'done',
      error: null,
      createdAt: 1700000000000,
      finishedAt: 1700000000200,
      elapsed: 200,
    }
    const images: StoredImage[] = [{
      id: 'img-1',
      dataUrl: 'data:image/png;base64,AAECAw==',
      source: 'generated',
    }, {
      id: 'img-2',
      dataUrl: 'data:image/png;base64,BAUGBw==',
      source: 'generated',
    }, {
      id: 'img-3',
      dataUrl: 'data:image/png;base64,CAkKCw==',
      source: 'generated',
    }]
    const thumbnail: StoredImageThumbnail = {
      id: 'img-1',
      thumbnailDataUrl: 'data:image/jpeg;base64,BAUG',
      width: 32,
      height: 24,
      thumbnailVersion: 2,
    }

    const { manifest, bytes } = buildExportZip({
      options: { exportConfig: true, exportTasks: true },
      exportedAt: 1700000001000,
      settings: {} as AppSettings,
      tasks: [task],
      images,
      thumbnailsByImageId: new Map([[thumbnail.id, thumbnail]]),
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
    })
    const parsed = readExportZip(bytes)

    expect(parsed.manifest).toEqual(manifest)
    expect(parsed.manifest.version).toBe(4)
    expect(parsed.manifest.exportedAt).toBe(new Date(1700000001000).toISOString())
    expect(parsed.manifest.imageFiles?.['img-1']).toEqual({
      path: 'images/task-task-1-input.png',
      createdAt: 1700000000000,
      source: 'generated',
      width: 32,
      height: 24,
    })
    expect(parsed.manifest.imageFiles?.['img-2']?.path).toBe('images/task-task-1.png')
    expect(parsed.manifest.imageFiles?.['img-3']?.path).toBe('images/task-task-1-partial.png')
    expect(parsed.manifest.thumbnailFiles?.['img-1']).toEqual({
      path: 'thumbnails/task-task-1-input.jpeg',
      width: 32,
      height: 24,
      thumbnailVersion: 2,
    })
    expect(readExportZipFileAsDataUrl(parsed.files, 'images/task-task-1-input.png')).toBe(images[0].dataUrl)
    expect(readExportZipFileAsDataUrl(parsed.files, 'images/task-task-1.png')).toBe(images[1].dataUrl)
    expect(readExportZipFileAsDataUrl(parsed.files, 'images/task-task-1-partial.png')).toBe(images[2].dataUrl)
    expect(readExportZipFileAsDataUrl(parsed.files, 'thumbnails/task-task-1-input.jpeg')).toBe(thumbnail.thumbnailDataUrl)
  })
})
