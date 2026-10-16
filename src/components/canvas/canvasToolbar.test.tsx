import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CanvasToolbar } from './canvasToolbar'

const noop = () => {}
const render = (selectedCount = 0) =>
  renderToStaticMarkup(
    <CanvasToolbar
      selectedCount={selectedCount}
      nodeCount={3}
      canvasTool="pan"
      canUndo
      canRedo={false}
      backgroundMode="dots"
      showImageInfo={false}
      onAddImage={noop}
      onAddText={noop}
      onAddConfig={noop}
      onAddGroup={noop}
      onUndo={noop}
      onRedo={noop}
      onUpload={noop}
      onDelete={noop}
      onClear={noop}
      onCanvasToolChange={noop}
      onBackgroundModeChange={noop}
      onShowImageInfoChange={noop}
    />,
  )

it('清空画布收进「更多」菜单，不和常用工具并排', () => {
  const html = render()
  expect(html).not.toContain('aria-label="清空画布"')
  expect(html).toContain('aria-label="更多"')
})

it('工具按钮标注快捷键，供提示和读屏使用', () => {
  const html = render(1)
  expect(html).toMatch(/aria-label="撤销" aria-keyshortcuts="(Ctrl|⌘) Z"/)
  expect(html).toMatch(/aria-label="重做" aria-keyshortcuts="(Ctrl|⌘) ⇧ Z"/)
  expect(html).toContain('aria-label="删除选中" aria-keyshortcuts="Delete"')
})
