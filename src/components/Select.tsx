import { useState, useRef, useEffect } from 'react'
import { DEFAULT_DROPDOWN_MAX_HEIGHT } from '../lib/dropdown'
import { ChevronDownIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'
import { useTooltip } from '../hooks/useTooltip'

interface Option {
  label: string
  value: string | number
}

interface SelectProps {
  value: string | number
  onChange: (value: any) => void
  options: Option[]
  disabled?: boolean
  className?: string
  onOpenChange?: (isOpen: boolean) => void
}

export default function Select({ value, onChange, options, disabled, className, onOpenChange }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(DEFAULT_DROPDOWN_MAX_HEIGHT)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const triggerTooltip = useTooltip()
  const [hoveredOptionTooltip, setHoveredOptionTooltip] = useState<string | number | null>(null)
  const optionTooltipTimerRef = useRef<number | null>(null)
  const optionLongPressTriggeredRef = useRef(false)

  const clearOptionTooltipTimer = () => {
    if (optionTooltipTimerRef.current) {
      window.clearTimeout(optionTooltipTimerRef.current)
      optionTooltipTimerRef.current = null
    }
  }

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => clearOptionTooltipTimer, [])

  useEffect(() => {
    onOpenChange?.(isOpen)
    if (!isOpen) {
      clearOptionTooltipTimer()
      setHoveredOptionTooltip(null)
      optionLongPressTriggeredRef.current = false
    }
  }, [isOpen, onOpenChange])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const updateMenuMaxHeight = () => {
      if (!triggerRef.current) return
      const trigger = triggerRef.current
      const rect = trigger.getBoundingClientRect()
      
      let availableBelow = window.innerHeight - rect.bottom - 8
      let availableAbove = rect.top - 8
      
      let parent = trigger.parentElement
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent)
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) {
          const parentRect = parent.getBoundingClientRect()
          availableBelow = Math.min(availableBelow, parentRect.bottom - rect.bottom - 8)
          availableAbove = Math.min(availableAbove, rect.top - parentRect.top - 8)
        }
        parent = parent.parentElement
      }
      
      let newPlacement: 'bottom' | 'top' = 'bottom'
      let maxHeight = DEFAULT_DROPDOWN_MAX_HEIGHT
      
      if (availableBelow < 120 && availableAbove > availableBelow) {
        newPlacement = 'top'
        maxHeight = Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, Math.floor(availableAbove))
      } else {
        newPlacement = 'bottom'
        maxHeight = Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, Math.floor(availableBelow))
      }
      
      setPlacement(newPlacement)
      setMenuMaxHeight(Math.max(0, maxHeight))
    }

    updateMenuMaxHeight()
    window.addEventListener('resize', updateMenuMaxHeight)
    window.addEventListener('scroll', updateMenuMaxHeight, true)
    return () => {
      window.removeEventListener('resize', updateMenuMaxHeight)
      window.removeEventListener('scroll', updateMenuMaxHeight, true)
    }
  }, [isOpen])

  const handleToggle = (e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    // 动画和位置的计算在 useEffect 中进行，这里可以先假设一个默认值或保留当前状态
    setIsOpen(!isOpen)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        ref={triggerRef}
        {...triggerTooltip.handlers}
        onClick={(e) => {
          triggerTooltip.handlers.onClick?.()
          handleToggle(e)
          triggerTooltip.dismiss()
        }}
        className={`flex items-center justify-between gap-1 w-full cursor-pointer select-none ${className ?? ''} ${
          disabled ? '!opacity-50 !cursor-not-allowed !bg-gray-100/50 dark:!bg-white/[0.05]' : ''
        }`}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDownIcon className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        <ViewportTooltip visible={triggerTooltip.visible} className="max-w-[300px] break-words whitespace-pre-wrap">
          {selectedOption?.label ?? value}
        </ViewportTooltip>
      </div>

      {isOpen && (
        <div
          className={`absolute z-50 w-full overflow-hidden overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 custom-scrollbar ${
            placement === 'top' ? 'bottom-full mb-1.5 animate-dropdown-up' : 'top-full mt-1.5 animate-dropdown-down'
          }`}
          style={{ maxHeight: menuMaxHeight }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              onTouchStart={() => {
                clearOptionTooltipTimer()
                optionLongPressTriggeredRef.current = false
                optionTooltipTimerRef.current = window.setTimeout(() => {
                  optionLongPressTriggeredRef.current = true
                  setHoveredOptionTooltip(option.value)
                }, 500)
              }}
              onTouchMove={clearOptionTooltipTimer}
              onTouchEnd={(e) => {
                clearOptionTooltipTimer()
                // 长按显示完整文字后松手不选中
                if (optionLongPressTriggeredRef.current && e.cancelable) e.preventDefault()
                optionLongPressTriggeredRef.current = false
              }}
              onTouchCancel={clearOptionTooltipTimer}
              onClick={(e) => {
                e.preventDefault()
                onChange(option.value)
                setIsOpen(false)
                clearOptionTooltipTimer()
                setHoveredOptionTooltip(null)
              }}
              onMouseEnter={() => setHoveredOptionTooltip(option.value)}
              onMouseLeave={() => {
                clearOptionTooltipTimer()
                setHoveredOptionTooltip(null)
              }}
              onFocus={() => setHoveredOptionTooltip(option.value)}
              onBlur={() => {
                clearOptionTooltipTimer()
                setHoveredOptionTooltip(null)
              }}
              className={`relative flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs transition-colors ${
                option.value === value
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
              }`}
            >
              {hoveredOptionTooltip === option.value && (
                <ViewportTooltip visible={true} className="max-w-[300px] break-words whitespace-pre-wrap">
                  {option.label}
                </ViewportTooltip>
              )}
              <span className="min-w-0 flex-1 truncate pr-2">{option.label}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
