import { defineConfig } from '@playwright/test'
if (!process.env.GOUO_STACK_URL) throw new Error('Set GOUO_STACK_URL to the isolated contract stack edge; this config never starts services')
export default defineConfig({
  testDir: '.', testMatch: 'integration.pw.mjs', fullyParallel: false, workers: 1, timeout: 90_000,
  use: { baseURL: process.env.GOUO_STACK_URL, browserName: 'chromium', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
