export type AtImageOption = {
  type: 'input'
  key: string
  label: string
  imageId: string
  dataUrl: string
  imageIndex: number
}

export default function AtImageOptionThumb({ option }: { option: AtImageOption }) {
  return (
    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-gray-200/70 bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04]">
      <img src={option.dataUrl} className="h-full w-full object-cover" alt="" />
    </span>
  )
}
