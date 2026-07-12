import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GUIDE_FLAGS, setGuideFlag } from '../lib/userGuidance'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, SparklesIcon } from './icons'

interface OnboardingModalProps {
  onClose: () => void
}

const STEPS = [
  {
    eyebrow: '第一步 · 描述画面',
    title: '从一句清楚的话开始',
    description: '写明主体、环境、构图和光线。没有想法时，可从空画廊示例或顶栏灵感库一键开始。',
    points: ['主体：想画什么', '画面：在哪里、怎样构图', '质感：光线、风格和限制'],
    tone: 'from-blue-600 to-indigo-900',
  },
  {
    eyebrow: '第二步 · 参考与局部编辑',
    title: '上传图片，并说明它的用途',
    description: '参考图不会自动决定结果。请在提示词中说明“保留什么、改变什么”，局部修改时再使用遮罩。',
    points: ['例如：保留图 1 的人物', '例如：采用图 2 的配色', '遮罩涂抹需要修改的区域'],
    tone: 'from-cyan-600 to-blue-900',
  },
  {
    eyebrow: '第三步 · 生成与保存',
    title: '确认价格，然后放心创作',
    description: '当前每次成功请求预计扣费 ¥0.10，失败会自动退回。完成后可下载、收藏或继续编辑，作品会同步到账号。',
    points: ['生成前查看预计扣费', '完成后下载、收藏或继续编辑', '余额不足可直接前往用户中心兑换'],
    tone: 'from-violet-600 to-slate-950',
  },
]

export default function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0)
  const modalRef = useRef<HTMLDivElement>(null)
  const current = STEPS[step]

  const finish = () => {
    setGuideFlag(GUIDE_FLAGS.onboarding)
    onClose()
  }

  useCloseOnEscape(true, finish)
  usePreventBackgroundScroll(true, modalRef)

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/65 backdrop-blur-md sm:items-center sm:p-6">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="光构新用户引导" className="w-full overflow-hidden rounded-t-[30px] border border-white/10 bg-white shadow-2xl dark:bg-gray-950 sm:max-w-3xl sm:rounded-[30px]">
        <div className={`relative min-h-56 overflow-hidden bg-gradient-to-br ${current.tone} p-6 text-white sm:p-8`}>
          <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full border border-white/15 bg-white/10" />
          <div className="absolute bottom-5 right-16 h-20 w-20 rotate-12 rounded-3xl border border-white/20 bg-white/10 backdrop-blur" />
          <button type="button" onClick={finish} className="absolute right-5 top-5 rounded-xl p-2 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="跳过引导"><CloseIcon className="h-5 w-5" /></button>
          <div className="relative max-w-xl">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20"><SparklesIcon className="h-6 w-6" /></div>
            <p className="text-xs font-bold tracking-[0.18em] text-white/65">{current.eyebrow}</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{current.title}</h2>
            <p className="mt-3 text-sm leading-6 text-white/75 sm:text-base">{current.description}</p>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-3">
            {current.points.map((point, index) => (
              <div key={point} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.035]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{index + 1}</span>
                <p className="mt-3 text-sm font-medium leading-6 text-gray-700 dark:text-gray-300">{point}</p>
              </div>
            ))}
          </div>
          <div className="mt-7 flex items-center justify-between gap-4">
            <div className="flex gap-1.5">{STEPS.map((_, index) => <span key={index} className={`h-1.5 rounded-full transition-all ${step === index ? 'w-8 bg-blue-600' : 'w-2 bg-gray-200 dark:bg-white/10'}`} />)}</div>
            <div className="flex gap-2">
              {step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.05]">上一步</button>}
              <button type="button" onClick={() => step === STEPS.length - 1 ? finish() : setStep((value) => value + 1)} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700">{step === STEPS.length - 1 ? '开始创作' : '下一步'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
