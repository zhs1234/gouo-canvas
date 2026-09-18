import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.pw.mjs', use: { baseURL: 'http://127.0.0.1:5174/studio/' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5174/studio/', reuseExistingServer: !process.env.CI },
})
