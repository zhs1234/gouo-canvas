import type { ChangeEvent, RefObject } from 'react'
import { Checkbox } from '../Checkbox'
import { ExportIcon, ImportIcon, TrashIcon } from '../icons'

interface DataSettingsTabProps {
  exportConfig: boolean
  setExportConfig: (checked: boolean) => void
  exportTasks: boolean
  setExportTasks: (checked: boolean) => void
  isExportingData: boolean
  onExport: () => void
  importConfig: boolean
  setImportConfig: (checked: boolean) => void
  importTasks: boolean
  setImportTasks: (checked: boolean) => void
  isImportingData: boolean
  importInputRef: RefObject<HTMLInputElement | null>
  onImport: (event: ChangeEvent<HTMLInputElement>) => void
  clearConfig: boolean
  setClearConfig: (checked: boolean) => void
  clearTasks: boolean
  setClearTasks: (checked: boolean) => void
  onClear: () => void
}

export default function DataSettingsTab(props: DataSettingsTabProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05] flex items-start gap-3">
        <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <div className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
          所有的配置、任务和生成的图片均仅保存在您的浏览器本地（除非您使用的服务商存储了它们）。如果您需要清理浏览器站点数据、重置浏览器或使用其他设备，请先导出备份。
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <ExportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={props.exportConfig} onChange={props.setExportConfig} label="包含配置" />
          <Checkbox checked={props.exportTasks} onChange={props.setExportTasks} label="包含任务和图片" />
        </div>
        <button
          onClick={props.onExport}
          disabled={(!props.exportConfig && !props.exportTasks) || props.isExportingData}
          className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
        >
          {props.isExportingData ? <LoadingLabel label="导出中..." /> : '导出所选数据'}
        </button>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <ImportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={props.importConfig} onChange={props.setImportConfig} label="包含配置" />
          <Checkbox checked={props.importTasks} onChange={props.setImportTasks} label="包含任务和图片" />
        </div>
        <button
          onClick={() => props.importInputRef.current?.click()}
          disabled={(!props.importConfig && !props.importTasks) || props.isImportingData}
          className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
        >
          {props.isImportingData ? <LoadingLabel label="导入中..." /> : '从 ZIP 导入所选数据'}
        </button>
        <input ref={props.importInputRef} type="file" accept=".zip" className="hidden" onChange={props.onImport} />
      </div>

      <div className="rounded-2xl border border-red-100/50 bg-red-50/30 p-4 dark:border-red-500/10 dark:bg-red-500/5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <TrashIcon className="w-4 h-4 text-red-500/90 dark:text-red-400" />
          <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除数据</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Checkbox checked={props.clearConfig} onChange={props.setClearConfig} label="包含配置" tone="danger" />
          <Checkbox checked={props.clearTasks} onChange={props.setClearTasks} label="包含任务和图片" tone="danger" />
        </div>
        <button
          onClick={props.onClear}
          disabled={!props.clearConfig && !props.clearTasks}
          className="w-full rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-500 transition-all hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 disabled:hover:bg-red-50/50 disabled:hover:border-red-200/60 disabled:hover:text-red-500 dark:border-red-500/15 dark:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 dark:hover:text-red-300 dark:disabled:hover:bg-red-500/5 dark:disabled:hover:border-red-500/15 dark:disabled:hover:text-red-400"
        >
          清空所选数据
        </button>
      </div>
    </div>
  )
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <>
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {label}
    </>
  )
}
