import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { formatParamValue, getParamDisplay, stripInternalPromptText } from './paramDisplay'

const task = (params: Partial<TaskRecord['params']>, actualParams?: TaskRecord['actualParams']): TaskRecord => ({
  id: 't',
  prompt: '',
  params: { ...DEFAULT_PARAMS, ...params },
  actualParams,
  inputImageIds: [],
  outputImages: [],
  status: 'done',
  error: null,
  createdAt: 0,
  finishedAt: 0,
  elapsed: 0,
})

describe('formatParamValue', () => {
  it('shows raw API values in Chinese', () => {
    expect(formatParamValue('quality', 'auto')).toBe('自动')
    expect(formatParamValue('quality', 'low')).toBe('低')
    expect(formatParamValue('quality', 'medium')).toBe('中')
    expect(formatParamValue('quality', 'high')).toBe('高')
    expect(formatParamValue('quality', 'xhigh')).toBe('超高')
    expect(formatParamValue('quality', 'max')).toBe('极致')
    expect(formatParamValue('output_format', 'png')).toBe('PNG')
    expect(formatParamValue('output_format', 'webp')).toBe('WebP')
    expect(formatParamValue('moderation', 'low')).toBe('宽松')
    expect(formatParamValue('transparent_output', true)).toBe('是')
    expect(formatParamValue('transparent_output', false)).toBe('否')
    expect(formatParamValue('size', 'auto')).toBe('自动')
    expect(formatParamValue('size', '1024x1536')).toBe('1024×1536')
    expect(formatParamValue('output_compression', 80)).toBe('80%')
    expect(formatParamValue('output_compression', null)).toBe('未设置')
    expect(formatParamValue('quality', 'ultra')).toBe('ultra')
  })

  it('compares requested and actual values by what the user sees', () => {
    expect(getParamDisplay(task({ size: '1024x1024' }, { size: '1024×1024' }), 'size').isMismatch).toBe(false)
    const size = getParamDisplay(task({ size: '1024x1024' }, { size: '1254x1254' }), 'size')
    expect(size).toMatchObject({ isMismatch: true, requestedValue: '1024×1024', displayValue: '1254×1254' })
    const quality = getParamDisplay(task({ quality: 'auto' }, { quality: 'high' }), 'quality')
    expect(quality).toMatchObject({ isMismatch: false, isAutoResolved: true, requestedValue: '自动', displayValue: '高' })
  })
})

describe('stripInternalPromptText', () => {
  it('removes request parameter sentences appended by the upstream', () => {
    expect(stripInternalPromptText('一只橘猫坐在窗台上 Requested output image size: 1024x1024.')).toBe('一只橘猫坐在窗台上')
    expect(stripInternalPromptText('A cat on a sofa.\n\nRequested output image size: 1536x1024.')).toBe('A cat on a sofa.')
    expect(stripInternalPromptText('海报 Requested output image size: 1024x1024. Requested output image quality: high')).toBe('海报')
  })

  it('keeps ordinary prompts untouched', () => {
    expect(stripInternalPromptText('Requested by the client: a red apple.')).toBe('Requested by the client: a red apple.')
    expect(stripInternalPromptText('  画一只猫  ')).toBe('画一只猫')
  })
})
