// Explicit isolated native contract test. Synthetic prices/funds only;
// local provider procurement cost is zero. No external model provider is used.
// Run from v2: node tests/stack/trial-native.cases.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import sharp from 'sharp'
import { createServer } from '../../apps/api/src/server.mjs'
import { loadConfig } from '../../apps/api/src/config.mjs'

const docker = process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker'
await mkdir(resolve('.local'), { recursive: true })
const directory = await mkdtemp(resolve('.local/native-trial-'))
const project = 'gouo-native-trial-' + process.pid + '-' + Date.now().toString(36)
const composePath = join(directory, 'compose.yml'), emptyEnv = join(directory, 'empty.env')
await mkdir(join(directory, 'data'))
await writeFile(emptyEnv, '')
await writeFile(composePath, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
      SESSION_SECRET: synthetic-isolated-test-session-secret
    ports: ['127.0.0.1::3000']
    volumes:
      - type: bind
        source: ${JSON.stringify(join(directory, 'data').replaceAll('\\', '/'))}
        target: /data
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 1s
      retries: 60
`)
function compose(...args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(docker, ['compose', '--env-file', emptyEnv, '-p', project, '-f', composePath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolvePromise(output) : reject(new Error(output)))
  })
}
let nativeOrigin, studio, studioDatabasePath
const provider = Fastify(), providerCalls = { chat: 0, image: 0, anonymousRejected: 0 }
function verifyStoredIntent(modelKind) {
  const db = new DatabaseSync(studioDatabasePath, { readOnly: true })
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM model_submissions').get().n, providerCalls.chat + providerCalls.image)
    const last = db.prepare('SELECT model_kind,funding_source FROM model_submissions ORDER BY rowid DESC LIMIT 1').get()
    assert.equal(last.model_kind, modelKind)
    assert.ok(['trial', 'wallet'].includes(last.funding_source))
  } finally { db.close() }
}
provider.addHook('preHandler', async (req, reply) => {
  if (req.headers.authorization !== 'Bearer fixture-provider-zero-procurement-cost') {
    providerCalls.anonymousRejected++; return reply.code(401).send({ error: 'Local fixture requires its synthetic channel credential' })
  }
})
provider.post('/v1/chat/completions', req => {
  providerCalls.chat++
  verifyStoredIntent('chat')
  const wantsImage = JSON.stringify(req.body.messages).includes('native fixture image')
  const hasToolResult = req.body.messages.some(m => m.role === 'tool')
  const message = wantsImage && !hasToolResult
    ? { role: 'assistant', content: '', tool_calls: [{ id: 'native-fixture-tool', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'local fixture output; procurement cost zero' }) } }] }
    : { role: 'assistant', content: 'Local fixture response; procurement cost zero.' }
  return { id: 'native-fixture-' + providerCalls.chat, object: 'chat.completion', created: 1, model: 'fixture-chat', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
})
const png = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#5a7b9c' } }).png().toBuffer()
provider.post('/v1/images/generations', () => { providerCalls.image++; verifyStoredIntent('image'); return { created: 1, data: [{ b64_json: png.toString('base64') }] } })
async function native(path, token, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(nativeOrigin + path, { method, headers: { Origin: nativeOrigin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
  const result = await response.json()
  assert.equal(response.ok && result.success === true, true, `Native ${method} ${path}: ${result.message ?? response.status}`)
  return result
}
async function login(username) { return (await native('/api/user/login', undefined, { username, password: 'Synthetic_fixture_2026!' })).data }
try {
  await provider.listen({ host: '127.0.0.1', port: 0 })
  const providerPort = provider.server.address().port
  assert.equal((await fetch('http://127.0.0.1:' + providerPort + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
  await compose('up', '-d', '--wait', '--wait-timeout', '90')
  const published = (await compose('port', 'new-api', '3000')).trim()
  assert.match(published, /^127\.0\.0\.1:\d+$/)
  assert.notEqual(published, '127.0.0.1:8080')
  nativeOrigin = 'http://' + published
  const checksum = await compose('exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api')
  assert.equal(checksum.split(' ')[0], 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529')
  await native('/api/setup', undefined, { username: 'fixture-root', password: 'Synthetic_fixture_2026!', confirmPassword: 'Synthetic_fixture_2026!', SelfUseModeEnabled: false, DemoSiteEnabled: false })
  // Direct seed is scoped to this random project's synthetic SQLite DB.
  // It is test data, not a human legal/compliance declaration or real funds.
  const seed = `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/data/new-api.db');
    const rows=${JSON.stringify({ 'payment_setting.compliance_confirmed': 'true', 'payment_setting.compliance_terms_version': 'v1', RetryTimes: '0', QuotaForNewUser: '0', ModelRatio: '{"fixture-chat":0.1}', CompletionRatio: '{"fixture-chat":1}', ModelPrice: '{"fixture-image":0.001}', GroupRatio: '{"default":1}' })};
    for(const [key,value] of Object.entries(rows))db.prepare('INSERT OR REPLACE INTO options(key,value) VALUES(?,?)').run(key,value);db.close();`
  await compose('exec', '-T', 'new-api', 'node', '-e', seed)
  await compose('restart', 'new-api')
  // Docker may allocate another random host port when restarting this container.
  nativeOrigin = 'http://' + (await compose('port', 'new-api', '3000')).trim()
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(nativeOrigin + '/api/status'); if (response.ok) break } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  const admin = await login('fixture-root')
  await native('/api/channel/', admin.access_token, { mode: 'single', channel: { type: 1, name: 'Local fixture; zero procurement cost', key: 'fixture-provider-zero-procurement-cost', status: 1, base_url: 'http://host.docker.internal:' + providerPort, models: 'fixture-chat,fixture-image', group: 'default' } })
  const plan = { price_amount: 0, total_amount: 500000, duration_unit: 'day', duration_value: 1, custom_seconds: 0, quota_reset_period: 'never', max_purchase_per_user: 1, allow_balance_pay: true, allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
  await native('/api/subscription/admin/plans', admin.access_token, { plan: { ...plan, title: 'Synthetic one-off trial; zero procurement cost', currency: 'USD', enabled: true, quota_reset_custom_seconds: 0 } })
  await native('/api/user/register', undefined, { username: 'fixture-trial', password: 'Synthetic_fixture_2026!' })
  const user = await login('fixture-trial'), token = user.access_token
  assert.equal(user.user.role, 1); assert.equal(user.user.quota, 0)
  const plans = (await native('/api/subscription/plans', token)).data
  assert.equal(plans.length, 1)
  const policy = { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', gatewayOrigin: nativeOrigin, instanceId: crypto.randomUUID(), minUserId: user.user.id, planId: plans[0].plan.id, operatorVerified: true, relayIngress: 'studio-only', plan }
  const policyPath = join(directory, 'policy.json'), routingPath = join(directory, 'routing.json')
  await writeFile(policyPath, JSON.stringify(policy))
  await writeFile(routingPath, JSON.stringify({ sourceCommit: policy.sourceCommit, gatewayOrigin: nativeOrigin, retryTimes: 0, operatorVerified: true, verifiedAt: new Date().toISOString() }))
  const config = loadConfig({ GOUO_STUDIO_MODELS_FILE: resolve('tests/stack/user-models.json'), GOUO_GATEWAY_BASE_URL: nativeOrigin + '/v1', GOUO_BACKEND_DEV_TARGET: nativeOrigin, GOUO_RELAY_CREDENTIAL_MODE: 'user-token', GOUO_RELAY_ROUTING_MODE: 'model', GOUO_USER_TOKEN_QUOTA_CAP: '500000', GOUO_USER_TOKEN_LIFETIME_SECONDS: '3600', GOUO_NORMAL_ROUTING_EVIDENCE_FILE: routingPath, GOUO_ENABLE_TRIAL: 'true', GOUO_TRIAL_POLICY_FILE: policyPath, GOUO_ENABLE_GENERATION: 'true', GOUO_STUDIO_LEDGER_PATH: join(directory, 'studio.sqlite') })
  studio = createServer(config)
  studioDatabasePath = config.ledgerPath
  const headers = { authorization: 'Bearer ' + token }
  assert.equal((await studio.inject({ url: '/api/studio/trial', headers })).json().data.state, 'eligible')
  const send = async prompt => { const id = crypto.randomUUID(); return studio.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers, 'idempotency-key': id }, payload: { runId: id, prompt, model: 'fixture-chat', sessionId: 'native-fixture', conversationId: 'native-fixture' } }) }
  const first = await send('native fixture image')
  assert.equal(first.statusCode, 200, first.body)
  assert.equal(first.json().data.events.at(-1).type, 'run.completed', first.body)
  for (let i = 0; i < 3; i++) { const response = await send('local fixture text'); assert.equal(response.statusCode, 200, response.body) }
  assert.equal((await send('local fixture exhausted')).statusCode, 402)
  const summary = (await studio.inject({ url: '/api/studio/trial', headers })).json().data
  assert.deepEqual(summary.chat, { limit: 4, remaining: 0, used: 4, held: 0 })
  assert.deepEqual(summary.image, { limit: 1, remaining: 0, used: 1, held: 0 })
  const self = (await native('/api/subscription/self', token)).data
  assert.equal(self.billing_preference, 'subscription_only')
  assert.equal(self.all_subscriptions.length, 1)
  assert.ok(self.all_subscriptions[0].subscription.amount_used > 0)
  const finalAccount = (await native('/api/user/self', token)).data
  assert.equal(finalAccount.quota, 0)
  const tokens = (await native('/api/token/search?keyword=gouo-studio&p=1&page_size=100', token)).data.items
  assert.equal(tokens.length, 1); assert.equal(tokens[0].user_id, user.user.id); assert.equal(tokens[0].unlimited_quota, false)
  assert.ok(tokens[0].remain_quota < 500000 && tokens[0].remain_quota > 0)
  let logs, stored
  // Native settlement/log flushing may be asynchronous. Poll read-only data;
  // never re-send model requests while awaiting durable evidence.
  const readStored = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/new-api.db',{readOnly:true});
    const owner=${user.user.id};console.log(JSON.stringify({wallet:db.prepare('SELECT quota FROM users WHERE id=?').get(owner).quota,
    subscription:db.prepare('SELECT amount_used FROM user_subscriptions WHERE user_id=?').get(owner).amount_used,
    logs:db.prepare('SELECT COUNT(*) AS n,SUM(quota) AS quota FROM logs WHERE user_id=? AND type=2').get(owner)}));db.close();`
  for (let i = 0; i < 30; i++) {
    logs = (await native('/api/log/self?type=2&p=1&page_size=100', token)).data.items
    stored = JSON.parse((await compose('exec', '-T', 'new-api', 'node', '-e', readStored)).split('\n').find(line => line.startsWith('{')))
    if (logs.length === 6 && stored.logs.n === 6 && stored.subscription === stored.logs.quota) break
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  assert.equal(logs.length, 6)
  assert.ok(logs.every(row => row.quota > 0 && row.request_id))
  const billing = logs.map(row => JSON.parse(row.other))
  assert.ok(billing.every(row => row.billing_source === 'subscription' && row.billing_preference === 'subscription_only'
    && row.wallet_quota_deducted === 0 && row.subscription_id === self.all_subscriptions[0].subscription.id
    && row.subscription_plan_id === policy.planId))
  assert.equal(logs.reduce((sum, row) => sum + row.quota, 0), self.all_subscriptions[0].subscription.amount_used)
  assert.deepEqual(stored, { wallet: 0, subscription: self.all_subscriptions[0].subscription.amount_used, logs: { n: 6, quota: self.all_subscriptions[0].subscription.amount_used } })
  assert.equal(finalAccount.used_quota, stored.subscription)
  assert.deepEqual(providerCalls, { chat: 5, image: 1, anonymousRejected: 1 })
  // A second real purchase is rejected by native MaxPurchasePerUser, not a fixture handler.
  const duplicate = await fetch(nativeOrigin + '/api/subscription/balance/pay', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: policy.planId }) })
  assert.equal((await duplicate.json()).success, false)
  // Second ordinary owner: four pure trial sends leave the image entitlement
  // untouched. A synthetic native voucher then funds explicit paid continuation.
  await native('/api/user/register', undefined, { username: 'fixture-mixed', password: 'Synthetic_fixture_2026!' })
  const mixedUser = await login('fixture-mixed'), mixedToken = mixedUser.access_token
  assert.equal(mixedUser.user.quota, 0)
  const mixedHeaders = { authorization: 'Bearer ' + mixedToken }
  const mixedSend = (prompt, payWithBalance = false, id = crypto.randomUUID(), model = 'fixture-chat') => studio.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...mixedHeaders, 'idempotency-key': id }, payload: { runId: id, prompt, model, payWithBalance, sessionId: 'mixed-fixture', conversationId: 'mixed-fixture' } })
  for (let i = 0; i < 4; i++) { const response = await mixedSend('local fixture pure trial'); assert.equal(response.statusCode, 200, response.body) }
  const beforeVoucher = (await studio.inject({ url: '/api/studio/trial', headers: mixedHeaders })).json().data
  assert.deepEqual(beforeVoucher.chat, { limit: 4, remaining: 0, used: 4, held: 0 })
  assert.deepEqual(beforeVoucher.image, { limit: 1, remaining: 1, used: 0, held: 0 })
  assert.equal((await mixedSend('local fixture no payment consent')).statusCode, 402)
  const trialToken = (await native('/api/token/search?keyword=gouo-studio&p=1&page_size=100', mixedToken)).data.items[0]
  const voucherKey = 'syntheticfixturevoucher000000001', voucherQuota = 10000
  assert.equal(voucherKey.length, 32)
  const voucherSeed = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/new-api.db');
    db.prepare('INSERT INTO redemptions(user_id,key,status,name,quota,created_time,redeemed_time,used_user_id,expired_time) VALUES(?,?,?,?,?,?,?,?,?)').run(${admin.user.id},${JSON.stringify(voucherKey)},1,'Synthetic test voucher; no merchant payment',${voucherQuota},${Math.floor(Date.now() / 1000)},0,0,0);db.close();`
  await compose('exec', '-T', 'new-api', 'node', '-e', voucherSeed)
  assert.equal((await native('/api/user/topup', mixedToken, { key: voucherKey })).data, voucherQuota)
  assert.equal((await native('/api/user/self', mixedToken)).data.quota, voucherQuota)
  const paidId = crypto.randomUUID(), paid = await mixedSend('native fixture image', true, paidId)
  assert.equal(paid.statusCode, 200, paid.body)
  assert.equal(paid.json().data.events.at(-1).type, 'run.completed', paid.body)
  const beforeReplay = { ...providerCalls }
  assert.equal((await mixedSend('native fixture image', true, paidId)).body, paid.body)
  assert.equal((await mixedSend('native fixture image', false, paidId)).statusCode, 409)
  assert.deepEqual(providerCalls, beforeReplay)
  assert.equal((await mixedSend('local fixture still needs explicit consent')).statusCode, 402)
  const paidImageId = crypto.randomUUID(), paidImage = await mixedSend('local fixture paid image', true, paidImageId, 'fixture-image')
  assert.equal(paidImage.statusCode, 200, paidImage.body)
  const mixedSummary = (await studio.inject({ url: '/api/studio/trial', headers: mixedHeaders })).json().data
  assert.deepEqual(mixedSummary.chat, { limit: 4, remaining: 0, used: 4, held: 0 })
  assert.deepEqual(mixedSummary.image, { limit: 1, remaining: 0, used: 1, held: 0 })
  let mixedLogs, mixedStored
  const readMixed = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/new-api.db',{readOnly:true});const owner=${mixedUser.user.id};
    console.log(JSON.stringify({wallet:db.prepare('SELECT quota FROM users WHERE id=?').get(owner).quota,subscription:db.prepare('SELECT amount_used FROM user_subscriptions WHERE user_id=?').get(owner).amount_used,
    token:db.prepare('SELECT remain_quota FROM tokens WHERE user_id=? AND name=?').get(owner,'gouo-studio').remain_quota,
    logs:db.prepare('SELECT COUNT(*) AS n,SUM(quota) AS quota FROM logs WHERE user_id=? AND type=2').get(owner),
    voucher:db.prepare('SELECT status,used_user_id FROM redemptions WHERE key=?').get(${JSON.stringify(voucherKey)})}));db.close();`
  for (let i = 0; i < 30; i++) {
    mixedLogs = (await native('/api/log/self?type=2&p=1&page_size=100', mixedToken)).data.items
    mixedStored = JSON.parse((await compose('exec', '-T', 'new-api', 'node', '-e', readMixed)).split('\n').find(line => line.startsWith('{')))
    if (mixedLogs.length === 8 && mixedStored.logs.n === 8 && mixedStored.logs.quota === 1072 && mixedStored.wallet === 9476 && mixedStored.subscription === 548) break
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  const mixedSources = mixedLogs.map(row => ({ ...row, billing: JSON.parse(row.other) }))
  assert.equal(mixedSources.filter(row => row.billing.billing_source === 'subscription').length, 5)
  assert.equal(mixedSources.filter(row => row.billing.billing_source === 'wallet').length, 3)
  assert.ok(mixedSources.every(row => row.billing.billing_preference === (row.billing.billing_source === 'wallet' ? 'wallet_only' : 'subscription_only')))
  assert.ok(mixedSources.filter(row => row.billing.billing_source === 'subscription').every(row => row.billing.wallet_quota_deducted === 0 && row.billing.subscription_consumed === row.quota && row.billing.subscription_plan_id === policy.planId))
  assert.equal(mixedSources.filter(row => row.billing.billing_source === 'subscription').reduce((sum, row) => sum + row.quota, 0), 548)
  assert.equal(mixedSources.filter(row => row.billing.billing_source === 'wallet').reduce((sum, row) => sum + row.quota, 0), 524)
  const paidRecord = (await studio.inject({ url: '/api/studio/requests/agent/' + paidId, headers: mixedHeaders })).json().data
  assert.deepEqual(paidRecord.attempts.map(attempt => mixedSources.find(row => row.request_id === attempt.requestId).billing.billing_source), ['wallet', 'subscription', 'wallet'])
  assert.deepEqual(paidRecord.submissions.map(submission => submission.selectedFundingSource), ['wallet', 'trial', 'wallet'])
  assert.deepEqual(paid.json().data.fundingSelection, { chat: 'wallet', image: 'trial' })
  const imageRecord = (await studio.inject({ url: '/api/studio/requests/agent/' + paidImageId, headers: mixedHeaders })).json().data
  assert.deepEqual(imageRecord.attempts.map(attempt => mixedSources.find(row => row.request_id === attempt.requestId).billing.billing_source), ['wallet'])
  assert.deepEqual(imageRecord.submissions.map(submission => submission.selectedFundingSource), ['wallet'])
  assert.equal((await studio.inject({ url: '/api/studio/requests/agent/' + paidId, headers })).statusCode, 404)
  const mixedAccount = (await native('/api/user/self', mixedToken)).data
  const mixedTokens = (await native('/api/token/search?keyword=gouo-studio&p=1&page_size=100', mixedToken)).data.items
  assert.equal(mixedTokens.length, 1); assert.equal(mixedTokens[0].id, trialToken.id); assert.equal(mixedTokens[0].expired_time, trialToken.expired_time)
  assert.equal(mixedTokens[0].remain_quota, 498928)
  assert.equal(mixedAccount.quota, 9476); assert.equal(mixedAccount.used_quota, 1072)
  assert.deepEqual(mixedStored, { wallet: 9476, subscription: 548, token: 498928, logs: { n: 8, quota: 1072 }, voucher: { status: 3, used_user_id: mixedUser.user.id } })
  assert.equal((await native('/api/user/self', token)).data.quota, 0)
  assert.equal((await native('/api/subscription/self', token)).data.all_subscriptions[0].subscription.amount_used, 560)
  assert.deepEqual(providerCalls, { chat: 11, image: 3, anonymousRejected: 1 })
  const evidence = { sourceCommit: policy.sourceCommit, binarySha256: checksum.split(' ')[0], provider: 'local explicit fixture', procurementCost: 0, nativeWalletQuota: finalAccount.quota, nativeUsedQuota: finalAccount.used_quota, nativeTokenRemaining: tokens[0].remain_quota, nativeSubscriptionCount: 1, nativeConsumedQuota: self.all_subscriptions[0].subscription.amount_used, nativeConsumeLogCount: logs.length, nativeLogFunding: 'subscription_only; subscription source; wallet deducted 0', sqlite: stored, mixedContinuation: { voucherQuota, sqlite: mixedStored, paidRunSources: ['wallet', 'subscription', 'wallet'], paidImageSources: ['wallet'], beforeFetchIntentVerified: true, sameTokenIdAndExpiry: true, paidReplayNoCalls: true, alteredConsentReplayRejected: true, crossOwnerReadRejected: true, trial: mixedSummary }, providerCalls, trial: summary, realPaidProviderCalls: 0 }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
  console.log('Isolated native trial passed. Evidence: ' + join(directory, 'evidence.json'))
} finally {
  await studio?.close()
  await provider.close()
  await compose('down', '--volumes', '--remove-orphans')
}
