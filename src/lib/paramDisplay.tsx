import { useEffect, useRef, useState } from 'react'
import type { TaskParams, TaskRecord } from '../types'
import ViewportTooltip from '../components/ViewportTooltip'

type ParamKey = keyof TaskParams

interface ParamValueProps {
  task: TaskRecord
  paramKey: ParamKey
  className?: string
  actualParams?: Partial<TaskParams>
}

interface ActualValueBadgeProps {
  value: string
  className?: string
  variant?: 'highlight' | 'normal'
}

export function ActualValueBadge({ value, className = '', variant = 'highlight' }: ActualValueBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const touchTimerRef = useRef<number | null>(null)
  const colorClass = variant === 'normal'
    ? 'bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400'
    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'

  useEffect(() => () => {
    if (touchTimerRef.current != null) window.clearTimeout(touchTimerRef.current)
  }, [])

  const clearTouchTimer = () => {
    if (touchTimerRef.current != null) {
      window.clearTimeout(touchTimerRef.current)
      touchTimerRef.current = null
    }
  }

  return (
    <span
      className={`relative inline-flex cursor-help ${colorClass} ${className}`}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      onClick={() => setTooltipVisible(true)}
      onTouchStart={() => {
        clearTouchTimer()
        touchTimerRef.current = window.setTimeout(() => {
          setTooltipVisible(true)
          touchTimerRef.current = null
        }, 450)
      }}
      onTouchEnd={clearTouchTimer}
      onTouchCancel={clearTouchTimer}
    >
      {value}
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        API 实际响应值
      </ViewportTooltip>
    </span>
  )
}

const PARAM_VALUE_LABELS: Partial<Record<ParamKey, Record<string, string>>> = {
  quality: { auto: '自动', low: '低', medium: '中', high: '高', standard: '标准', hd: '高清' },
  output_format: { png: 'PNG', jpeg: 'JPEG', jpg: 'JPEG', webp: 'WebP' },
  moderation: { auto: '自动', low: '宽松' },
}

// 把接口里的原始参数值转成界面文案，未知值原样显示
export function formatParamValue(paramKey: ParamKey, value: unknown) {
  if (value === undefined || value === null || value === '') return '未设置'
  const text = String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (paramKey === 'size') return text === 'auto' ? '自动' : text.replace(/^(\d+)\s*[x×*]\s*(\d+)$/i, '$1×$2')
  if (paramKey === 'output_compression') return `${text}%`
  return PARAM_VALUE_LABELS[paramKey]?.[text.toLowerCase()] ?? text
}

// 部分上游会把请求参数以英文句子拼进 revised_prompt（如「Requested output image size: 1024x1024.」），展示前去掉
const INTERNAL_PROMPT_SENTENCE = /(^|\s)Requested output image [a-z ]+:[^\n]*?(?:\.(?=\s|$)|$)/gim

export function stripInternalPromptText(prompt: string) {
  return prompt.replace(INTERNAL_PROMPT_SENTENCE, '$1').replace(/[ \t]+\n/g, '\n').trim()
}

export function getParamDisplay(task: TaskRecord, paramKey: ParamKey, actualParams = task.actualParams) {
  const requestedValue = task.params[paramKey]
  const actualValue = actualParams?.[paramKey]
  const hasActualValue = actualValue !== undefined && actualValue !== null
  const displayValue = hasActualValue ? actualValue : requestedValue
  const isMismatch =
    hasActualValue &&
    requestedValue !== 'auto' &&
    formatParamValue(paramKey, actualValue) !== formatParamValue(paramKey, requestedValue)

  return {
    displayValue: formatParamValue(paramKey, displayValue),
    isMismatch,
    requestedValue: formatParamValue(paramKey, requestedValue),
    isAutoResolved: hasActualValue && requestedValue === 'auto' && String(actualValue) !== 'auto',
  }
}

export function DetailParamValue({ task, paramKey, className = '', actualParams }: ParamValueProps) {
  const { displayValue, isMismatch, requestedValue, isAutoResolved } = getParamDisplay(task, paramKey, actualParams)

  if (!isMismatch) {
    if (isAutoResolved) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <ActualValueBadge value={displayValue} variant="normal" className="rounded px-1 py-0.5" />
        </span>
      )
    }
    return <span className={`text-gray-700 dark:text-gray-300 ${className}`}>{displayValue}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <ActualValueBadge value={displayValue} className="rounded px-1 py-0.5" />
    </span>
  )
}
