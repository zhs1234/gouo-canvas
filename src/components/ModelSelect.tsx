import { ChevronDownIcon } from './icons'

interface ModelSelectProps {
  label: string
  value: string
  models: { id: string; name: string }[]
  disabled?: boolean
  compact?: boolean
  placeholder?: string
  onChange: (value: string) => void
}

export default function ModelSelect({ label, value, models, disabled = false, compact = false, placeholder = '请选择模型', onChange }: ModelSelectProps) {
  const selected = models.some((model) => model.id === value)

  return (
    <span className={compact ? 'relative inline-flex min-w-0 items-center text-xs text-gray-400' : 'inline-flex min-w-0'}>
      <select
        aria-label={label}
        value={selected ? value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={compact
          ? 'min-w-0 max-w-[260px] cursor-pointer appearance-none rounded-lg border-0 bg-transparent py-1.5 pl-2 pr-7 text-inherit outline-none hover:bg-white/[0.05] hover:text-gray-200 focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-inherit [&>option]:bg-gray-900 [&>option]:text-gray-200'
          : 'max-w-[260px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-400 dark:border-white/10 dark:bg-gray-800'}
      >
        {!selected && <option value="">{placeholder}</option>}
        {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      {compact && <ChevronDownIcon aria-hidden="true" className={`pointer-events-none absolute right-2 h-3.5 w-3.5${disabled ? ' opacity-50' : ''}`} />}
    </span>
  )
}
