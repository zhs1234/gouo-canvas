import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { loadConfigFromFile } from 'vite'
import { BRAND } from '../config/brand'

// 与 Vite toOutputFilePathWithoutRuntime 一致：相对 base 发 ./，其余把 base 接到文件前。
function emittedHref(base, file) {
  if (base === './' || base === '') return `./${file}`
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return prefix + (file.startsWith('/') ? file : `/${file}`)
}

function passwordResetPath() {
  const source = readFileSync(new URL('../../server/controller/misc.go', import.meta.url), 'utf8')
  const match = source.match(/func passwordResetLink\([\s\S]*?return config\.ServerAddress \+ "([^"]*)"/)
  if (!match) throw new Error('找不到 passwordResetLink 的返回路径')
  return match[1].split('?')[0]
}

function resetPage(path) {
  const query = new URLSearchParams({ email: 'name+tag@example.com', token: 'token&1' })
  return `https://canvas.example.com${path}?${query}`
}

describe('password reset link assets', () => {
  it('loads JS and CSS from /assets on the email link, / and /topup', async () => {
    vi.stubEnv('VITE_BASE', '')
    try {
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' })
      const resetPath = passwordResetPath()
      expect(resetPath).toBe('/user/reset')
      const pages = [resetPage(resetPath), 'https://canvas.example.com/', 'https://canvas.example.com/topup']
      for (const file of ['assets/index.js', 'assets/index.css']) {
        const href = emittedHref(loaded.config.base, file)
        const pathnames = pages.map((page) => new URL(href, page).pathname)
        expect(pathnames).toEqual([`/${file}`, `/${file}`, `/${file}`])
      }
      // 重置页页眉用这张图；相对路径会请求到 /user/gouo-logo-192.png
      expect(new URL(BRAND.logoUrl, resetPage(resetPath)).pathname).toBe('/gouo-logo-192.png')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('built index.html asset URLs stay on /assets when opened at /user/reset', () => {
    const distIndex = new URL('../../dist/index.html', import.meta.url)
    if (!existsSync(distIndex)) {
      if (process.env.CHECK_BUILT_RESET_ASSETS === '1') throw new Error('缺少 dist/index.html')
      return
    }
    const html = readFileSync(distIndex, 'utf8')
    const hrefs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((href) => !/^https?:/.test(href))
    const resetUrl = resetPage(passwordResetPath())
    const scripts = []
    const styles = []
    for (const href of hrefs) {
      const resolved = new URL(href, resetUrl)
      expect(resolved.pathname.startsWith('/user/')).toBe(false)
      if (resolved.pathname.endsWith('.js')) scripts.push(resolved.pathname)
      if (resolved.pathname.endsWith('.css')) styles.push(resolved.pathname)
    }
    expect(scripts.some((path) => path.startsWith('/assets/'))).toBe(true)
    expect(styles.some((path) => path.startsWith('/assets/'))).toBe(true)

    const bundle = readdirSync(new URL('../../dist/assets/', import.meta.url))
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(new URL(`../../dist/assets/${name}`, import.meta.url), 'utf8'))
      .join('\n')
    const logos = [...bundle.matchAll(/['"`]([^'"`]*gouo-logo-192\.png)['"`]/g)].map((match) => match[1])
    expect(logos.length).toBeGreaterThan(0)
    for (const logo of logos) expect(new URL(logo, resetUrl).pathname).toBe('/gouo-logo-192.png')
  })
})
