import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../apps/api/src/config.mjs'
import { validateNormalRouting } from '../apps/api/src/relay.mjs'

// Explicit nonsecret inputs only. Never inherits process.env or loads .env/key files.
const args = process.argv.slice(2)
const allowed = new Set(['--models', '--evidence', '--gateway'])
try {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('参数无效')
    options[args[i]] = args[i + 1]
  }
  const path = options['--models'] || fileURLToPath(new URL('../config/loomic.models.normal.example.json', import.meta.url))
  const config = loadConfig({ GOUO_STUDIO_MODELS_FILE: path })
  if (config.models.some(model => model.enabled || model.verification !== 'pending' || model.channelId !== undefined)) throw new Error('准备目录必须全部 pending/disabled 且没有 channelId')
  if (options['--evidence']) {
    if (!options['--gateway']) throw new Error('核验记录检查需要 --gateway')
    validateNormalRouting(JSON.parse(readFileSync(options['--evidence'], 'utf8')), options['--gateway'], config.models)
  } else if (options['--gateway']) throw new Error('--gateway 必须配合 --evidence')
  console.log('非秘密模型目录通过：全部禁用/待验证。未读取环境变量或密钥，未连接网关。')
  if (options['--evidence']) console.log('人工核验记录格式通过；此命令不能证明运行实例 RetryTimes=0 或模型可用。')
} catch {
  console.error('非秘密配置检查失败。仅允许 --models <模型JSON> [--evidence <人工核验JSON> --gateway <地址>]；核对字段、禁用状态与固定版本记录。')
  process.exitCode = 1
}
