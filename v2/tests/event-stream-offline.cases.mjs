// Node contract tests for the actual shared browser SSE reader. The existing
// TypeScript compiler removes types in memory; no generated files or browser,
// Native, provider, authentication, or network calls are involved.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../apps/studio/src/event-stream.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
const { readEventStream } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const encoder = new TextEncoder()
const disconnect = /浏览器已离线.*结果和费用待确认.*仅读取原请求/

function browser(t, online = true) {
  const originals = new Map(['window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const listeners = new Set()
  class Window extends EventTarget {
    addEventListener(type, callback, options) {
      if (type === 'offline') listeners.add(callback)
      super.addEventListener(type, callback, options)
    }
    removeEventListener(type, callback, options) {
      if (type === 'offline') listeners.delete(callback)
      super.removeEventListener(type, callback, options)
    }
  }
  const window = new Window(), navigator = { onLine: online }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator })
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { listeners, offline() { navigator.onLine = false; window.dispatchEvent(new Event('offline')) } }
}

function stream({ frames = [], closed = false, rejectCancel = false } = {}) {
  let cancellations = 0, pulls = 0
  const body = new ReadableStream({
    start(controller) {
      if (frames.length) controller.enqueue(encoder.encode(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('')))
      if (closed) controller.close()
    },
    pull() { pulls++ },
    cancel() { cancellations++; if (rejectCancel) return Promise.reject(new Error('synthetic cancellation rejection')) },
  }, { highWaterMark: 0 })
  return { response: new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }),
    body, cancellations: () => cancellations, pulls: () => pulls }
}

test('offline while waiting for data interrupts the pending read, cancels reception and removes its listener', { timeout: 1000 }, async t => {
  const environment = browser(t), fixture = stream(), iterator = readEventStream(fixture.response)
  const pending = iterator.next()
  assert.equal(environment.listeners.size, 1)
  environment.offline()
  await assert.rejects(pending, disconnect)
  assert.equal(fixture.cancellations(), 1)
  assert.equal(fixture.body.locked, false)
  assert.equal(environment.listeners.size, 0)
  environment.offline()
  assert.equal(fixture.cancellations(), 1, 'a later event cannot affect an ended reader')
})

test('offline after one yielded event prevents a second buffered event while retaining the delivered partial reply', async t => {
  const environment = browser(t)
  const first = { type: 'message.delta', runId: 'synthetic-run', delta: '已有的部分内容' }
  const second = { type: 'message.delta', runId: 'synthetic-run', delta: '断线后不应显示' }
  const fixture = stream({ frames: [first, second] }), iterator = readEventStream(fixture.response)
  const delivered = await iterator.next()
  assert.deepEqual(delivered, { done: false, value: first })
  environment.offline()
  await assert.rejects(iterator.next(), disconnect)
  assert.deepEqual(delivered.value, first, 'already delivered content remains available to the caller')
  assert.equal(fixture.cancellations(), 1)
  assert.equal(fixture.body.locked, false)
  assert.equal(environment.listeners.size, 0)
})

test('normal EOF delivers the final event and removes the offline listener without canceling completed work', async t => {
  const environment = browser(t), event = { type: 'run.completed', runId: 'synthetic-run' }
  const fixture = stream({ frames: [event], closed: true }), delivered = []
  for await (const value of readEventStream(fixture.response)) delivered.push(value)
  assert.deepEqual(delivered, [event])
  assert.equal(environment.listeners.size, 0)
  assert.equal(fixture.body.locked, false)
  environment.offline()
  assert.equal(fixture.cancellations(), 0)
})

test('consumer return after a partial event cancels local reception and removes its listener', async t => {
  const environment = browser(t), event = { type: 'tool.completed', artifacts: [{ type: 'image', url: 'synthetic-local-image' }] }
  const fixture = stream({ frames: [event] }), iterator = readEventStream(fixture.response)
  assert.deepEqual((await iterator.next()).value, event)
  assert.equal(environment.listeners.size, 1)
  assert.deepEqual(await iterator.return(), { value: undefined, done: true })
  assert.equal(fixture.cancellations(), 1)
  assert.equal(fixture.body.locked, false)
  assert.equal(environment.listeners.size, 0)
  environment.offline()
  assert.equal(fixture.cancellations(), 1)
})

test('an already offline browser yields no buffered event and does not request another chunk', async t => {
  const environment = browser(t, false), fixture = stream({ frames: [{ type: 'message.delta', delta: '不可显示' }] })
  const iterator = readEventStream(fixture.response)
  await assert.rejects(iterator.next(), disconnect)
  assert.equal(fixture.pulls(), 0)
  assert.equal(fixture.cancellations(), 1)
  assert.equal(fixture.body.locked, false)
  assert.equal(environment.listeners.size, 0)
})

test('a failing local cancel still reports disconnection and releases the lock and listener', { timeout: 1000 }, async t => {
  const environment = browser(t), fixture = stream({ rejectCancel: true }), iterator = readEventStream(fixture.response)
  const pending = iterator.next()
  environment.offline()
  await assert.rejects(pending, disconnect)
  assert.equal(fixture.cancellations(), 1)
  assert.equal(fixture.body.locked, false)
  assert.equal(environment.listeners.size, 0)
})
