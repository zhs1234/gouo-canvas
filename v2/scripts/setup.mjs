import { spawnSync } from 'node:child_process'
import { existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 16)) { console.error('需要 Node.js >=22.16（推荐 Node 22 LTS）'); process.exit(1) }
if (!existsSync(`${root}/.env`)) copyFileSync(`${root}/.env.example`, `${root}/.env`)
const command = existsSync(`${root}/package-lock.json`) ? 'ci' : 'install'
console.log(`Installing V2 only with npm ${command}. Legacy root/server are unchanged.`)
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [command, '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) { console.error(result.error.message); process.exit(1) }
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('Ready: cd v2 && npm run check && npm run dev')
console.log(command === 'ci' ? '已按 V2 锁文件安装依赖。' : '首次生成的 v2/package-lock.json 应与测试结果一起提交；之后使用 npm ci。')
