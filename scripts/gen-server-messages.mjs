// 从 New API 的中文语言包里摘出客户端会遇到的服务端提示，生成 src/lib/serverMessages.ts。
// 服务端只返回英文 message_key；New API 升级后运行 node scripts/gen-server-messages.mjs 重新生成
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const zh = JSON.parse(readFileSync('server/web/src/i18n/locales/zh.json', 'utf8')).translation
const files = [
  ...['user', 'misc', 'email_binding', 'secure_verification', 'auth_session', 'log', 'topup', 'relay'].map((name) => `server/controller/${name}.go`),
  ...['security_verification', 'email_binding', 'auth_session', 'login_verification'].map((name) => `server/service/${name}.go`),
  'server/model/user.go', 'server/model/redemption.go',
  ...readdirSync('server/middleware').filter((name) => name.endsWith('.go') && !name.endsWith('_test.go')).map((name) => `server/middleware/${name}`),
]
const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
const keys = Object.keys(zh).filter((key) => key.includes(' ') && source.includes(JSON.stringify(key)))
const lines = keys.sort().map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(zh[key])},`)
writeFileSync('src/lib/serverMessages.ts', `// 由 scripts/gen-server-messages.mjs 生成，请勿手改\nexport const SERVER_MESSAGES: Record<string, string> = {\n${lines.join('\n')}\n}\n`)
console.log(keys.length)
