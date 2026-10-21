import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { appendPrompt, getReferenceImageIssue, MAX_PROMPT_LENGTH, MAX_REFERENCE_IMAGE_BYTES, parseImageCount, promptCodePointLength, readReferenceImageFile, sniffReferenceImageType } from './inputValidation'
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
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const close = vi.fn()
    const decode = vi.fn(async (file: File) => {
      if (file.name === 'broken.png') throw new Error('decode failed')
      return { close }
    })
    vi.stubGlobal('createImageBitmap', decode)
    await expect(readReferenceImageFile(new File([png], 'broken.png', { type: 'image/png' }))).rejects.toThrow('「broken.png」无法识别为图片，请重新上传')
    await expect(readReferenceImageFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow('格式不支持')
    expect(decode).toHaveBeenCalledTimes(1)
    await expect(readReferenceImageFile(new File([png], 'ok.png', { type: 'image/png' }))).resolves.toBe('data:image/png;base64,iVBORw0KGgo=')
    // 不带类型的文件按文件头识别，存成正确的类型
    expect(getReferenceImageIssue({ name: 'IMG_1', type: '', size: 10 })).toBe('')
    await expect(readReferenceImageFile(new File([png], 'IMG_1'))).resolves.toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(close).toHaveBeenCalled()
  })

  it('rejects a GIF renamed to png even when the browser can decode it', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
    expect(sniffReferenceImageType(gif)).toBe('')
    expect(sniffReferenceImageType(jpeg)).toBe('image/jpeg')
    expect(sniffReferenceImageType(webp)).toBe('image/webp')
    const decode = vi.fn(async () => ({ close: vi.fn() }))
    vi.stubGlobal('createImageBitmap', decode)
    await expect(readReferenceImageFile(new File([gif], 'anim.png', { type: 'image/png' }))).rejects.toThrow('「anim.png」格式不支持，请上传 PNG、JPEG 或 WebP 图片')
    expect(decode).not.toHaveBeenCalled()
    await expect(readReferenceImageFile(new File([jpeg], 'photo.png', { type: 'image/png' }))).resolves.toMatch(/^data:image\/jpeg;base64,/)
    await expect(readReferenceImageFile(new File([webp], 'photo.webp', { type: 'image/webp' }))).resolves.toMatch(/^data:image\/webp;base64,/)
  })
})

describe('prompt length', () => {
  it('counts Unicode code points so emoji stay within the server limit', () => {
    expect(promptCodePointLength('')).toBe(0)
    expect(promptCodePointLength('猫')).toBe(1)
    expect(promptCodePointLength('😀')).toBe(1)
    expect('😀'.length).toBe(2)
    const within = '😀'.repeat(16001)
    expect(within.length).toBeGreaterThan(MAX_PROMPT_LENGTH)
    expect(promptCodePointLength(within)).toBeLessThanOrEqual(MAX_PROMPT_LENGTH)
    expect(promptCodePointLength('a'.repeat(MAX_PROMPT_LENGTH))).toBe(MAX_PROMPT_LENGTH)
    expect(promptCodePointLength(`${'a'.repeat(MAX_PROMPT_LENGTH)}😀`)).toBe(MAX_PROMPT_LENGTH + 1)
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

it('appends a template after the existing prompt instead of replacing it', () => {
  expect(appendPrompt('一只猫  \n', '赛博朋克海报')).toBe('一只猫\n\n赛博朋克海报')
  expect(appendPrompt('   ', '赛博朋克海报')).toBe('赛博朋克海报')
})
