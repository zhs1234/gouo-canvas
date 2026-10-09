import { useEffect, useRef, useState } from 'react'
import { App, Button, ConfigProvider, Input, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { I18nextProvider } from 'react-i18next'
import { ArrowLeft, Download, Plus, RotateCcw, Search, Trash2, Upload } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useThemeStore } from '../../lib/canvas/uiStore'
import { exportCanvasProjects, importCanvasArchive } from '../../lib/canvas/export'
import { CanvasEditor } from './canvasEditor'
import i18n from '../../lib/canvas/i18n'
import './canvas.css'

export interface CanvasWorkspaceProps {
  projectId?: string
  onOpenProject: (id: string) => void
  onOpenAgent: (projectId: string) => void
}

export default function CanvasWorkspace(props: CanvasWorkspaceProps) {
  const colorTheme = useThemeStore((state) => state.theme)
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <I18nextProvider i18n={i18n}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: colorTheme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: { colorPrimary: '#5b8fff', borderRadius: 10, fontFamily: 'inherit' },
        }}
        getPopupContainer={() => rootRef.current || document.body}
      >
        <div ref={rootRef} className={`canvas-workspace h-full min-h-0 w-full ${colorTheme === 'dark' ? 'dark' : ''}`} data-theme={colorTheme}>
          <App className="h-full min-h-0">
            <CanvasContent {...props} />
          </App>
        </div>
      </ConfigProvider>
    </I18nextProvider>
  )
}

function CanvasContent({ projectId, onOpenProject, onOpenAgent }: CanvasWorkspaceProps) {
  const { message, modal } = App.useApp()
  const projects = useCanvasStore((state) => state.projects)
  const hydrated = useCanvasStore((state) => state.hydrated)
  const error = useCanvasStore((state) => state.error)
  const [query, setQuery] = useState('')
  const [trash, setTrash] = useState(false)
  const [selected, setSelected] = useState(new Set<string>())
  const [busy, setBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const current = projects.find((project) => project.id === projectId && !project.hiddenAt)
  const perform = async (action: () => Promise<unknown>) => {
    try {
      setBusy(true)
      await action()
    } catch (err) {
      console.error('画布项目操作失败', err)
      void message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void useCanvasStore
      .getState()
      .hydrate()
      .catch((err) => console.error('读取画布失败', err))
  }, [])
  if (!hydrated)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <span role={error ? 'alert' : 'status'}>{error || '正在读取画布…'}</span>
        {error && <Button onClick={() => void perform(() => useCanvasStore.getState().hydrate())}>重新读取</Button>}
      </div>
    )
  if (current) return <CanvasEditor key={current.id} project={current} onOpenProject={onOpenProject} onOpenAgent={onOpenAgent} />
  const visible = projects
    .filter((project) => Boolean(project.hiddenAt) === trash && project.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="h-full overflow-y-auto px-5 py-8 md:px-12 md:py-12">
      <div className="mx-auto max-w-6xl">
        {projectId && (
          <div role="alert" className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            这张画布不存在或已移入回收站。
            <button className="ml-2 underline" onClick={() => onOpenProject('')}>
              返回列表
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{trash ? '画布回收站' : '我的画布'}</h1>
            <p className="mt-2 text-sm opacity-45">用图片、文本和连接，把想法铺展开。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={trash ? <ArrowLeft className="size-4" /> : <Trash2 className="size-4" />}
              onClick={() => {
                setTrash(!trash)
                setSelected(new Set())
              }}
            >
              {trash ? '返回画布' : '回收站'}
            </Button>
            <Button icon={<Upload className="size-4" />} loading={busy} onClick={() => importRef.current?.click()}>
              导入画布
            </Button>
            <Button
              type="primary"
              icon={<Plus className="size-4" />}
              loading={busy}
              onClick={() =>
                void perform(async () => {
                  const project = await useCanvasStore.getState().createProject()
                  onOpenProject(project.id)
                })
              }
            >
              新建画布
            </Button>
          </div>
        </div>
        <div className="my-8 flex items-center justify-between gap-4">
          <Input
            prefix={<Search className="size-4 opacity-40" />}
            className="max-w-xs"
            placeholder="搜索画布"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            allowClear
          />
          <div className="flex gap-2">
            {selected.size > 0 && (
              <>
                <Button
                  icon={<Download className="size-4" />}
                  loading={busy}
                  onClick={() => void perform(() => exportCanvasProjects(projects.filter((item) => selected.has(item.id))))}
                >
                  导出 {selected.size} 张
                </Button>
                <Button
                  onClick={() =>
                    modal.confirm({
                      title: trash ? '恢复所选画布？' : '将所选画布移入回收站？',
                      okText: '确认',
                      cancelText: '取消',
                      onOk: async () => {
                        for (const id of selected) await useCanvasStore.getState().hideProject(id, !trash)
                        setSelected(new Set())
                      },
                    })
                  }
                >
                  {trash ? '恢复' : '移入回收站'}
                </Button>
              </>
            )}
          </div>
        </div>
        {visible.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((project) => (
              <article
                key={project.id}
                className="group flex min-h-44 flex-col justify-between rounded-2xl bg-black/5 p-5 transition hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${project.title}`}
                    checked={selected.has(project.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        next.has(project.id) ? next.delete(project.id) : next.add(project.id)
                        return next
                      })
                    }
                    className="mt-1 size-4"
                  />
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => (trash ? void perform(() => useCanvasStore.getState().hideProject(project.id, false)) : onOpenProject(project.id))}
                  >
                    <h2 className="truncate text-xl font-semibold">{project.title}</h2>
                    <p className="mt-3 text-sm opacity-50">
                      {project.nodes.length} 个节点 · {project.connections.length} 条连接
                    </p>
                  </button>
                </div>
                {[...project.title].length > 200 && (
                  <div role="alert" className="mt-3 text-xs text-amber-600 dark:text-amber-300">
                    <p>标题超过 200 个字符，原内容已保留在本地，请重命名后再保存到服务器</p>
                    {(
                      <button
                        type="button"
                        className="mt-2 underline"
                        onClick={() => {
                          let title = project.title
                          modal.confirm({
                            title: '重命名画布（最多 200 个字符）',
                            content: (
                              <Input
                                defaultValue={title}
                                aria-label="新的画布标题"
                                onChange={(event) => {
                                  title = event.target.value
                                }}
                              />
                            ),
                            okText: '保存',
                            cancelText: '取消',
                            onOk: async () => {
                              try {
                                await useCanvasStore.getState().renameProject(project.id, title)
                              } catch (err) {
                                void message.error(err instanceof Error ? err.message : String(err))
                                throw err
                              }
                            },
                          })
                        }}
                      >
                        重命名
                      </button>
                    )}
                  </div>
                )}
                <div className="mt-8 flex items-end justify-between gap-3">
                  <p className="text-xs opacity-40">
                    {new Date(project.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="text"
                      size="small"
                      aria-label={`导出 ${project.title}`}
                      icon={<Download className="size-4" />}
                      onClick={() => void perform(() => exportCanvasProjects([project], project.title))}
                    />
                    <Button
                      type="text"
                      size="small"
                      aria-label={trash ? `恢复 ${project.title}` : `删除 ${project.title}`}
                      icon={trash ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />}
                      onClick={() => void perform(() => useCanvasStore.getState().hideProject(project.id, !trash))}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-current/10">
            <h2 className="text-xl font-medium opacity-70">{trash ? '回收站是空的' : query ? '没有找到这张画布' : '你的下一张画布，从这里开始'}</h2>
            <p className="mt-3 text-sm opacity-40">{trash ? '移入回收站的画布可随时恢复' : '创建项目，或者导入已导出的画布备份'}</p>
          </div>
        )}
        <div className="mt-10 text-xs opacity-35">
          <a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">
            画布界面基于 Infinite Canvas · MIT
          </a>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file)
              void perform(async () => {
                const imported = await importCanvasArchive(file)
                void message.success(`已导入 ${imported.length} 张画布`)
                onOpenProject(imported[0].id)
              })
          }}
        />
      </div>
    </div>
  )
}
