import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const excalidrawRequire = createRequire(require.resolve('@excalidraw/excalidraw'))
test.setTimeout(60_000)
let converterCode

test.beforeAll(async () => {
  // 用项目构建器处理父包实际使用的转换器，不绕过 CommonJS/browser 导出解析。
  const result = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false,
    lib: { entry: excalidrawRequire.resolve('@excalidraw/mermaid-to-excalidraw'), formats: ['es'] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  } })
  converterCode = (Array.isArray(result) ? result[0] : result).output.find(chunk => chunk.type === 'chunk' && chunk.isEntry).code
})

test('Mermaid dependency compatibility preserves diagrams, bindings and fallback asset IDs', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { success: false } }))
  await page.route('**/qa-mermaid.js', route => route.fulfill({ contentType: 'application/javascript', body: converterCode }))
  await page.goto('./')
  const diagrams = await page.evaluate(async () => {
    const { parseMermaidToExcalidraw } = await import('/studio/qa-mermaid.js')
    const definitions = {
      flow: 'flowchart LR\n  A[Start] --> B[Finish]',
      sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Done',
      class: 'classDiagram\n  class Product {\n    +String name\n  }\n  Order --> Product',
      er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string name\n  }',
    }
    const results = {}
    for (const [name, definition] of Object.entries(definitions)) results[name] = await parseMermaidToExcalidraw(definition)
    return results
  })
  expect(diagrams.flow.elements.map(element => element.type)).toEqual(['rectangle', 'rectangle', 'arrow'])
  expect(diagrams.flow.elements.map(element => element.label?.text).filter(Boolean)).toEqual(['Start', 'Finish'])
  const arrow = diagrams.flow.elements.find(element => element.type === 'arrow')
  expect(arrow.start.id).toBe('A')
  expect(arrow.end.id).toBe('B')
  expect(diagrams.sequence.elements).toHaveLength(8)
  expect(diagrams.sequence.elements.filter(element => element.type === 'arrow').map(element => element.label.text)).toEqual(['Hello', 'Done'])
  // 固定父包当前将类图/ER 图保留为 SVG 素材；安全更新不能改变这个行为。
  for (const name of ['class', 'er']) {
    const { elements, files } = diagrams[name]
    expect(elements).toHaveLength(1)
    expect(elements[0].type).toBe('image')
    const id = elements[0].fileId
    expect(id).toMatch(/^[\w-]{21}$/)
    expect(Object.keys(files)).toEqual([id])
    expect(files[id].id).toBe(id)
    expect(files[id].mimeType).toBe('image/svg+xml')
    expect(files[id].dataURL).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(elements[0].width).toBeGreaterThan(0)
    expect(elements[0].height).toBeGreaterThan(0)
  }
  expect(diagrams.class.elements[0].fileId).not.toBe(diagrams.er.elements[0].fileId)
})
