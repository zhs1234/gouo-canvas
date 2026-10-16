import { useEffect, useState, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TaskRecord } from '../types'
import { useStore, ensureImageThumbnailCached, subscribeImageThumbnail, retryTask, toggleTaskFavorite } from '../store'
import { formatImageRatio } from '../lib/size'
import { getParamDisplay, ActualValueBadge } from '../lib/paramDisplay'
import { useImageModels } from '../hooks/useImageModels'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { EditIcon, FavoriteIcon, TransparentBgIcon, TrashIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  disableSwipe?: boolean
}

function TaskActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={className}
        disabled={disabled}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

type SheetAction = { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }

// 触屏设备上卡片操作收进「更多」，以底部面板展示，每项点击区域不小于 44px
function TaskActionSheet({ actions, onClose }: { actions: SheetAction[]; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, sheetRef)
  // 面板通过 portal 渲染，React 事件仍会冒泡回卡片，需要拦住避免打开详情或触发滑动选择
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-end justify-center"
      onClick={(e) => {
        stop(e)
        onClose()
      }}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onTouchCancel={stop}
    >
      <div className="absolute inset-0 bg-black/30 animate-overlay-in" />
      <div
        ref={sheetRef}
        role="menu"
        aria-label="作品操作"
        className="relative w-full max-w-md rounded-t-2xl bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-gray-900 animate-modal-in"
        onClick={stop}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              onClose()
              action.onClick()
            }}
            className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-4 text-left text-[15px] transition hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-white/[0.06] ${
              action.danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center">{action.icon}</span>
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-gray-100 text-[15px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300"
        >
          取消
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default function TaskCard({
  task,
  onReuse,
  onEditOutputs,
  onDelete,
  onClick,
  isSelected,
  disableSwipe,
}: Props) {
  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')
  const [now, setNow] = useState(Date.now())
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const settings = useStore((s) => s.settings)
  // 显示后台填写的模型名；模型已下架或目录未加载时退回模型 ID
  const modelName = useImageModels().find((model) => model.id === task.apiModel)?.name || task.apiModel
  const [sheetOpen, setSheetOpen] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeResetTimerRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<-1 | 0 | 1>(0)
  const swipeActionActiveRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)
  const swipeFrameRef = useRef<number | null>(null)

  const updateSwipeDirection = (nextDirection: -1 | 0 | 1) => {
    if (swipeDirectionRef.current === nextDirection) return
    swipeDirectionRef.current = nextDirection
    setSwipeDirection(nextDirection)
  }

  const updateSwipeActionActive = (nextActive: boolean) => {
    if (swipeActionActiveRef.current === nextActive) return
    swipeActionActiveRef.current = nextActive
    setSwipeActionActive(nextActive)
  }

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) {
      cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
    }
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const isTagScrollTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('[data-tag-scroll-area]'))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disableSwipe || isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      applySwipeOffset(0)
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(Boolean(isSelected))
    updateSwipeActionActive(false)
    updateSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) return
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y
    
    // 如果主要是水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      // 限制滑动距离，例如最大 60px
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      const nextDirection = boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0
      const nextActionActive = Math.abs(deltaX) >= 40
      scheduleSwipeOffset(boundedOffset)
      updateSwipeDirection(nextDirection)
      updateSwipeActionActive(nextActionActive)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    updateSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      updateSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)

    // 如果是水平滑动，且垂直偏移较小，认为是滑动选择
    if (isSwipeAction) {
      suppressClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      toggleTaskSelection(task.id)
    }
  }

  const handleTouchCancel = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    updateSwipeActionActive(false)
  }

  useEffect(() => () => {
    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
    }
    cancelSwipeFrame()
  }, [])

  useEffect(() => {
    if (!isSwiping) {
      applySwipeOffset(0)
    }
  }, [isSwiping])

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (task.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [task.status])

  // 加载缩略图
  useEffect(() => {
    setCoverRatio('')
    setCoverSize('')
    setThumbSrc('')

    let cancelled = false
    const imageId = task.outputImages?.[0]
    let unsubscribe: (() => void) | undefined

    const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setThumbSrc(thumbnail.dataUrl)
      if (thumbnail.width && thumbnail.height) {
        setCoverRatio(formatImageRatio(thumbnail.width, thumbnail.height))
        setCoverSize(`${thumbnail.width}×${thumbnail.height}`)
      }
    }

    if (imageId) {
      unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
      ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (cancelled || !thumbnail) return
        applyThumbnail(thumbnail)
      }).catch(() => {
        if (!cancelled) setThumbSrc('')
      })
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [task.outputImages])

  const duration = (() => {
    let seconds: number
    if (task.status === 'running') {
      seconds = Math.floor((now - task.createdAt) / 1000)
    } else if (task.elapsed != null) {
      seconds = Math.floor(task.elapsed / 1000)
    } else {
      return '00:00'
    }
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  })()
  const showSwipeAction = swipeActionActive
  const showRunningTimer = task.status === 'running'
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-gray-500 dark:bg-gray-600'
      : 'bg-blue-500'
    : 'bg-gray-200 dark:bg-gray-700'

  const qualityDisplay = getParamDisplay(task, 'quality')
  const showQuality = task.params.quality !== 'auto' || qualityDisplay.isMismatch

  const sizeDisplay = getParamDisplay(task, 'size')
  const showSize = task.params.size !== 'auto' || sizeDisplay.isMismatch

  const formatDisplay = getParamDisplay(task, 'output_format')
  const showFormat = task.params.output_format !== 'png' || formatDisplay.isMismatch
  const showTransparentOutput = task.transparentOutput || task.params.transparent_output

  const nDisplay = getParamDisplay(task, 'n')
  const showN = task.params.n > 1 || nDisplay.isMismatch
  const outputErrorCount = task.outputErrors?.length ?? 0
  const outputSuccessCount = task.outputImages?.length ?? 0
  const requestedOutputCount = Math.max(task.params.n, outputSuccessCount + outputErrorCount)
  const hasPartialOutputFailure = task.status === 'done' && outputErrorCount > 0

  const isInterrupted = task.status === 'error' && task.error === '已停止生成。'
  const createdAt = new Date(task.createdAt)
  const createdAtText = createdAt.toLocaleString('zh-CN', {
    ...(createdAt.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const showRetry = task.status === 'error' || settings.alwaysShowRetryButton
  const sheetActions: SheetAction[] = [
    ...(showRetry ? [{ label: '重试任务', icon: <RetryIcon className="h-5 w-5" />, onClick: () => retryTask(task) }] : []),
    { label: task.isFavorite ? '取消收藏' : '收藏', icon: <FavoriteIcon filled={task.isFavorite} className="h-5 w-5 text-yellow-500" />, onClick: () => void toggleTaskFavorite(task.id) },
    { label: '复用配置', icon: <ReuseIcon className="h-5 w-5" />, onClick: onReuse },
    { label: '编辑输出', icon: <EditIcon className="h-5 w-5" />, onClick: onEditOutputs, disabled: !task.outputImages?.length },
    { label: task.cloudHiddenAt ? '恢复作品' : '删除任务', icon: <TrashIcon className="h-5 w-5" />, onClick: onDelete, danger: !task.cloudHiddenAt },
  ]

  return (
    <div className="relative rounded-xl">
      {/* 侧滑底图 */}
      <div
        className={`absolute inset-0 rounded-xl flex items-center transition-opacity duration-200 pointer-events-none ${
          isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'
        } ${swipeBgClass} ${
          swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'
        }`}
      >
        <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>

      <div
        ref={cardRef}
        className={`group relative bg-white dark:bg-gray-900 rounded-xl border overflow-hidden cursor-pointer touch-pan-y will-change-transform duration-200 hover:shadow-lg dark:hover:bg-gray-800/80 ${
          isSwiping ? '!bg-white dark:!bg-gray-900' : ''
        } ${
          !isSwiping ? 'transition-[box-shadow,border-color,background-color,transform]' : 'transition-[box-shadow,border-color,background-color]'
        } ${
          task.status === 'running'
            ? 'border-blue-400 generating'
            : isSelected
            ? 'border-blue-500 shadow-md ring-2 ring-blue-500/50'
            : 'border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.18]'
        }`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
      {/* 选中时的角标 */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {!isSelected && task.cloudHiddenAt && (
        <div className="absolute right-2 top-2 z-10 rounded-full bg-gray-900/75 px-2 py-1 text-[10px] font-medium text-white shadow-sm backdrop-blur">回收站</div>
      )}
      {/* 图片区域 */}
      <div className="relative aspect-square bg-gray-100 dark:bg-black/20 flex items-center justify-center overflow-hidden">
        {task.status === 'running' && (
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-8 h-8 text-blue-400 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-xs text-gray-400 dark:text-gray-500">生成中...</span>
          </div>
        )}
        {task.status === 'error' && (
          <div className="flex flex-col items-center gap-1 px-2">
            <svg
              className={`w-7 h-7 ${isInterrupted ? 'text-yellow-400' : 'text-red-400'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className={`text-xs text-center leading-tight ${isInterrupted ? 'text-yellow-500' : 'text-red-400'}`}>
              {isInterrupted ? '已停止' : '失败'}
            </span>
          </div>
        )}
        {task.status === 'done' && thumbSrc && (
          <>
            <img
              src={thumbSrc}
              data-image-id={task.outputImages[0]}
              data-output-image-ids={task.outputImages.join(',')}
              className="saveable-image w-full h-full object-cover"
              loading="lazy"
              alt=""
            />
            {(hasPartialOutputFailure || task.outputImages.length > 1) && (
              <span className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                {hasPartialOutputFailure ? <>{requestedOutputCount} | <span className="font-semibold text-yellow-300">{outputSuccessCount}</span></> : task.outputImages.length}
              </span>
            )}
          </>
        )}
        {task.status === 'done' && !thumbSrc && (
          <svg
            className="w-8 h-8 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )}
        {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
          {showRunningTimer || task.status !== 'done' || !coverRatio || !coverSize ? (
            <span className="flex items-center gap-1 bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {duration}
            </span>
          ) : (
            <>
              <span className="bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                {coverRatio}
              </span>
              <span className="bg-black/50 text-white/90 text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-medium">
                {coverSize}
              </span>
            </>
          )}
        </div>
        {/* 触屏设备：操作收进「更多」，避免常驻图标遮挡图片 */}
        <button
          type="button"
          aria-label="更多操作"
          aria-haspopup="menu"
          className="absolute bottom-0 right-0 hidden h-11 w-11 items-center justify-center [@media(hover:none)]:flex"
          onClick={(e) => {
            e.stopPropagation()
            setSheetOpen(true)
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchCancel={(e) => e.stopPropagation()}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </span>
        </button>
        {/* 操作按钮：鼠标设备悬停显示 */}
        <div
          data-tag-scroll-area
          className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-lg bg-black/45 p-0.5 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:hidden"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchCancel={(e) => e.stopPropagation()}
        >
        {showRetry && (
          <TaskActionButton
            tooltip="重试任务"
            onClick={() => retryTask(task)}
            className="p-1.5 rounded-md text-white/85 hover:bg-white/15 hover:text-blue-300 transition"
          >
            <RetryIcon className="w-4 h-4" />
          </TaskActionButton>
        )}
        <TaskActionButton
          tooltip={task.isFavorite ? '取消收藏' : '收藏'}
          onClick={() => void toggleTaskFavorite(task.id)}
          className={`p-1.5 rounded-md transition hover:bg-white/15 ${task.isFavorite ? 'text-yellow-300' : 'text-white/85 hover:text-yellow-300'}`}
        >
          <svg
            className="w-4 h-4"
            fill={task.isFavorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </TaskActionButton>
        <TaskActionButton
          tooltip="复用配置"
          onClick={onReuse}
          className="p-1.5 rounded-md text-white/85 hover:bg-white/15 hover:text-blue-300 transition"
        >
          <ReuseIcon className="w-4 h-4" />
        </TaskActionButton>
        <TaskActionButton
          tooltip="编辑输出"
          onClick={onEditOutputs}
          className="p-1.5 rounded-md text-white/85 hover:bg-white/15 hover:text-green-300 transition disabled:opacity-30"
          disabled={!task.outputImages?.length}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </TaskActionButton>
        <TaskActionButton
          tooltip="删除任务"
          onClick={onDelete}
          className="p-1.5 rounded-md text-white/85 hover:bg-white/15 hover:text-red-300 transition"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </TaskActionButton>
        </div>
      </div>

      {/* 提示词与参数 */}
      <div className="flex min-w-0 flex-col gap-1.5 p-2.5">
        <p className="min-h-[2.5rem] text-xs leading-5 text-gray-700 line-clamp-2 dark:text-gray-300">
          {task.prompt || '(无提示词)'}
        </p>
        <time dateTime={createdAt.toISOString()} className="text-[11px] leading-4 text-gray-400 dark:text-gray-500">
          {createdAtText}
        </time>
        <div
          data-tag-scroll-area
          className="flex overflow-x-auto hide-scrollbar gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchCancel={(e) => e.stopPropagation()}
        >
        {/* Model */}
        {task.apiModel && (
          <span 
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 text-xs flex-shrink-0"
            title={task.apiModel}
          >
            <svg className="w-3 h-3 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <span className="truncate max-w-[8rem]">
              {modelName}
            </span>
          </span>
        )}
        {/* Mask */}
        {task.maskImageId && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs flex-shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            局部重绘
          </span>
        )}
        {/* Transparent background */}
        {showTransparentOutput && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs flex-shrink-0">
            <TransparentBgIcon className="w-3 h-3 flex-shrink-0" />
            透明背景
          </span>
        )}
        {/* Params: only show if not default or mismatch */}
        {showQuality && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
            <span className="text-gray-400 dark:text-gray-500">质量</span>
            {qualityDisplay.isMismatch ? <ActualValueBadge value={qualityDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{qualityDisplay.displayValue}</span>}
          </span>
        )}
        {showSize && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
            <span className="text-gray-400 dark:text-gray-500">尺寸</span>
            {sizeDisplay.isMismatch ? <ActualValueBadge value={sizeDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{sizeDisplay.displayValue}</span>}
          </span>
        )}
        {showFormat && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
            <span className="text-gray-400 dark:text-gray-500">格式</span>
            {formatDisplay.isMismatch ? <ActualValueBadge value={formatDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{formatDisplay.displayValue}</span>}
          </span>
        )}
        {showN && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
            <span className="text-gray-400 dark:text-gray-500">数量</span>
            {nDisplay.isMismatch ? <ActualValueBadge value={nDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{nDisplay.displayValue}</span>}
          </span>
        )}
        </div>
      </div>
      </div>
      {sheetOpen && <TaskActionSheet actions={sheetActions} onClose={() => setSheetOpen(false)} />}
    </div>
  )
}

function RetryIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function ReuseIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  )
}
