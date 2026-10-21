import { ChevronDownIcon } from './icons'

interface ModelSelectProps {
  label: string
  value: string
  models: { id: string; name: string; description?: string }[]
  disabled?: boolean
  compact?: boolean
  placeholder?: string
  onChange: (value: string) => void
}

export default function ModelSelect({ label, value, models, disabled = false, compact = false, placeholder = '请选择模型', onChange }: ModelSelectProps) {
  const selected = models.some((model) => model.id === value)

  return (
    <span className={compact ? 'composer-chip' : 'inline-flex min-w-0'}>
      <select
        aria-label={label}
        value={selected ? value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={compact
          ? ''
          : 'max-w-[260px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-400 dark:border-white/10 dark:bg-gray-800'}
      >
        {!selected && <option value="">{placeholder}</option>}
        {models.map((model) => <option key={model.id} value={model.id} title={model.description}>{model.description ? `${model.name} · ${model.description}` : model.name}</option>)}
      </select>
      {compact && <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5" />}
    </span>
  )
}
