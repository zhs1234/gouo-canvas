// Reproducible isolated Native UI harness; generation/trial off, no providers.
// Start from v2: node tests/stack/account-browser-isolation.mjs start
// Stop only its random project: node tests/stack/account-browser-isolation.mjs stop <state.json>
// Mount an already-built current Studio: ... refresh-web <state.json>
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
const docker = process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker'
let state
function compose(...args) {
  return new Promise((res, reject) => {
    const child = spawn(docker, ['compose', '--env-file', state.env, '-p', state.project, '-f', state.compose, ...(state.webOverride ? ['-f', state.webOverride] : []), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
    child.on('error', reject); child.on('exit', code => code === 0 ? res(output) : reject(new Error('Isolated Docker operation failed: ' + code)))
  })
}
if (['stop', 'refresh-web'].includes(process.argv[2])) {
  state = JSON.parse(await readFile(process.argv[3], 'utf8'))
  assert.match(state.project, /^gouo-native-browser-\d+-[a-z0-9]+$/)
  if (process.argv[2] === 'stop') {
    await compose('down', '--volumes', '--remove-orphans'); console.log('Stopped own isolated project: ' + state.project)
  } else {
    const studioDist = resolve('apps/studio/dist')
    await readFile(join(studioDist, 'index.html'), 'utf8')
    state.webOverride = join(state.directory, 'current-studio.yml')
    await writeFile(state.webOverride, JSON.stringify({ services: { web: { volumes: [{ type: 'bind', source: studioDist.replaceAll('\\', '/'), target: '/usr/share/nginx/html/studio', read_only: true }] } } }))
    await compose('up', '-d', '--no-deps', '--force-recreate', 'web')
    await compose('exec', '-T', 'web', 'nginx', '-t')
    await writeFile(process.argv[3], JSON.stringify(state, null, 2))
    console.log('Mounted current built Studio and prepared edge only in own project: ' + state.origin)
  }
} else if (process.argv[2] === 'start') {
  await mkdir(resolve('.local'), { recursive: true }); await mkdir(resolve('output/playwright'), { recursive: true })
  const directory = await mkdtemp(resolve('.local/native-browser-'))
  const socket = createServer(); await new Promise(res => socket.listen(0, '127.0.0.1', res)); const port = socket.address().port; await new Promise(res => socket.close(res))
  assert.notEqual(port, 8080)
  state = { project: 'gouo-native-browser-' + process.pid + '-' + Date.now().toString(36), directory, origin: 'http://127.0.0.1:' + port, compose: join(directory, 'compose.yml'), env: join(directory, 'empty.env'), generationEnabled: false, trialEnabled: false, sourceCommit: '0aec08fee811ec6136828fda790551b49e410301' }
  await writeFile(state.env, '')
  const source = resolve('apps/api/src').replaceAll('\\', '/'), nginx = resolve('deploy/nginx.studio-only.conf').replaceAll('\\', '/')
  await writeFile(state.compose, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
      SESSION_SECRET: synthetic-browser-isolation-secret
      PASSWORD_LOGIN_ENCRYPTION_ENABLED: 'true'
    tmpfs: ['/data']
  studio-api:
    image: gouo-v2-studio-api:latest
    environment:
      GOUO_STUDIO_HOST: 0.0.0.0
      GOUO_BACKEND_DEV_TARGET: http://new-api:3000
      GOUO_GATEWAY_BASE_URL: http://new-api:3000/v1
      GOUO_STUDIO_LEDGER_PATH: /data/requests.sqlite
      GOUO_ENABLE_GENERATION: 'false'
      GOUO_ENABLE_TRIAL: 'false'
    tmpfs: ['/data:uid=1000,gid=1000,mode=0700']
    volumes:
      - type: bind
        source: ${JSON.stringify(source)}
        target: /app/apps/api/src
        read_only: true
  web:
    image: gouo-v2-web:latest
    environment:
      GOUO_PUBLIC_ORIGIN: '${state.origin}'
    ports: ['127.0.0.1:${port}:8080']
    volumes:
      - type: bind
        source: ${JSON.stringify(nginx)}
        target: /etc/nginx/templates/default.conf.template
        read_only: true
`)
  await writeFile(join(directory, 'state.json'), JSON.stringify(state, null, 2))
  try {
    await compose('up', '-d')
    for (let i = 0; i < 60; i++) { try { if ((await fetch(state.origin + '/api/status')).ok) break } catch {} await new Promise(res => setTimeout(res, 500)) }
    state.binarySha256 = (await compose('exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api')).split(' ')[0]
    assert.equal(state.binarySha256, 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529')
    const setup = "fetch('http://127.0.0.1:3000/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'fixture-root',password:'Synthetic_browser_setup_2026!',confirmPassword:'Synthetic_browser_setup_2026!',SelfUseModeEnabled:false,DemoSiteEnabled:false})}).then(r=>r.json()).then(v=>{if(!v.success)process.exit(1);console.log('Synthetic root setup complete')})"
    await compose('exec', '-T', 'new-api', 'node', '-e', setup)
    await compose('exec', '-T', 'web', 'nginx', '-t')
    await writeFile(join(directory, 'state.json'), JSON.stringify(state, null, 2))
    console.log(JSON.stringify({ origin: state.origin, stateFile: join(directory, 'state.json'), project: state.project, generationEnabled: false, trialEnabled: false, realPaidCost: 0 }))
  } catch (error) { await compose('down', '--volumes', '--remove-orphans'); throw error }
} else throw new Error('Use start or stop <state.json>')
