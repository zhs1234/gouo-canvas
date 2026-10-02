import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests', testMatch: '**/ecommerce.pw.mjs', workers: 1,
  timeout: 60000, expect: { timeout: 10000 },
  outputDir: './output/playwright/ecommerce',
  use: { baseURL: 'http://127.0.0.1:5189/studio/', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev --workspace @gouo/studio -- --port 5189 --strictPort', url: 'http://127.0.0.1:5189/studio/', reuseExistingServer: false },
})
