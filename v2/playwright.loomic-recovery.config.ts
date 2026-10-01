import { defineConfig } from '@playwright/test'
// Isolated, explicit frontend fixtures: no API/Native service or paid model.
export default defineConfig({
  testDir: './tests', testMatch: 'loomic-recovery.pw.mjs', workers: 1,
  outputDir: '.local/sys-r2-playwright', use: { baseURL: 'http://127.0.0.1:5188/studio/', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev --workspace @gouo/studio -- --port 5188 --strictPort', url: 'http://127.0.0.1:5188/studio/', reuseExistingServer: false },
})
