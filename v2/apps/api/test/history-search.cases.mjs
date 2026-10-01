import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.mjs'

test('thread title search is read-only, owner scoped, literal and paginated; invalid search fails closed', async t => {
  let models = 0
  const app = createServer({ authOrigin: 'http://fixture.invalid', gateway: 'http://fixture.invalid/v1', relayOwnerId: 7,
    relayKey: 'fixture-key', allowGeneration: false, ledgerPath: ':memory:', models: [] }, {
    fetch: async (_url, init) => Response.json({ success: true, data: { id: init.headers.Authorization === 'Bearer other' ? 8 : 7 } }),
    runAgent: async () => { models++; throw new Error('search must never generate') },
  })
  t.after(() => app.close())
  const get = (search = '', offset = 0, token = 'owner') => app.inject({ url: '/api/studio/threads?' + new URLSearchParams({ search, offset: String(offset) }), headers: { authorization: 'Bearer ' + token } })
  const create = async (title, token = 'owner') => {
    const result = await app.inject({ method: 'POST', url: '/api/studio/threads', headers: { authorization: 'Bearer ' + token }, payload: { title } })
    assert.equal(result.statusCode, 200); return result.json().data.id
  }
  for (let i = 0; i < 56; i++) await create(`分页标记 ${String(i).padStart(2, '0')}`)
  const percent = await create('字面 %_\\ 样本')
  await create('字面 abc 样本')
  await create('他人唯一标题', 'other')
  const first = (await get('  分页标记  ')).json().data
  assert.equal(first.items.length, 50); assert.equal(first.nextOffset, 50)
  const second = (await get('分页标记', first.nextOffset)).json().data
  assert.equal(second.items.length, 6); assert.equal(second.nextOffset, null)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 56)
  assert.equal((await get('分页标记 01')).json().data.items.length, 1)
  for (const search of ['%', '_', '\\', '%_\\']) assert.deepEqual((await get(search)).json().data.items.map(item => item.id), [percent])
  assert.deepEqual((await get('他人唯一标题')).json().data.items, [])
  assert.equal((await get('他人唯一标题', 0, 'other')).json().data.items.length, 1)
  assert.deepEqual((await get("' OR 1=1 --")).json().data.items, [])
  assert.equal((await get('x'.repeat(101))).statusCode, 400)
  assert.equal((await app.inject({ url: '/api/studio/threads?search=a&search=b', headers: { authorization: 'Bearer owner' } })).statusCode, 400)
  assert.equal((await app.inject({ url: '/api/studio/threads?search=分页标记' })).statusCode, 401)
  assert.deepEqual((await get('')).json().data, (await app.inject({ url: '/api/studio/threads', headers: { authorization: 'Bearer owner' } })).json().data)
  assert.equal(models, 0)
})
