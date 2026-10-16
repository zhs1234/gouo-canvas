import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { getReferenceImageIssue, MAX_REFERENCE_IMAGE_BYTES, parseImageCount, readReferenceImageFile } from './inputValidation'
import { normalizeTaskParams } from './paramCompatibility'

afterEach(() => { vi.unstubAllGlobals() })

describe('reference image upload checks', () => {
  it('rejects non-image files and oversized images with a readable reason', () => {
    expect(getReferenceImageIssue({ name: 'notes.txt', type: 'text/plain', size: 10 })).toContain('格式不支持')
    expect(getReferenceImageIssue({ name: 'anim.gif', type: 'image/gif', size: 10 })).toContain('格式不支持')
    expect(getReferenceImageIssue({ name: 'big.png', type: 'image/png', size: 60 * 1024 * 1024 })).toBe('「big.png」超过 20 MB，请压缩后再上传')
    expect(getReferenceImageIssue({ name: 'edge.png', type: 'image/png', size: MAX_REFERENCE_IMAGE_BYTES })).toBe('')
    expect(getReferenceImageIssue({ name: 'photo.webp', type: 'image/webp', size: 1024 })).toBe('')
    expect(getReferenceImageIssue({ name: 'IMG_20261016_123456_screenshot.bmp', type: 'image/bmp', size: 1024 })).toBe('「IMG_20261016…shot.bmp」格式不支持，请上传 PNG、JPEG 或 WebP 图片')
  })

  it('refuses files that cannot be decoded before they reach the image store', async () => {
    const close = vi.fn()
    const decode = vi.fn(async (file: File) => {
      if (file.name === 'fake.png') throw new Error('decode failed')
      return { close }
    })
    vi.stubGlobal('createImageBitmap', decode)
    await expect(readReferenceImageFile(new File(['not a png'], 'fake.png', { type: 'image/png' }))).rejects.toThrow('「fake.png」无法识别为图片，请重新上传')
    await expect(readReferenceImageFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow('格式不支持')
    expect(decode).toHaveBeenCalledTimes(1)
    await expect(readReferenceImageFile(new File([new Uint8Array([1, 2, 3])], 'ok.png', { type: 'image/png' }))).resolves.toBe('data:image/png;base64,AQID')
    expect(close).toHaveBeenCalled()
  })
})

describe('image count input', () => {
  it('accepts only integers within the limit', () => {
    expect(parseImageCount('3', 4)).toBe(3)
    expect(parseImageCount('2.5', 4)).toBeNull()
    expect(parseImageCount('0', 4)).toBeNull()
    expect(parseImageCount('5', 4)).toBeNull()
    expect(parseImageCount('', 4)).toBeNull()
    expect(parseImageCount('abc', 4)).toBeNull()
  })

  it('repairs a fractional count restored from older saved settings', () => {
    expect(normalizeTaskParams({ ...DEFAULT_PARAMS, n: 2.5 }).n).toBe(2)
    expect(normalizeTaskParams({ ...DEFAULT_PARAMS, n: 0.5 }).n).toBe(1)
  })
})
