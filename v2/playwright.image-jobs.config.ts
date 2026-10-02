import { defineConfig } from '@playwright/test'
// F HTTP responses only. No API/Native processes, provider access or paid call.
export default defineConfig({
  testDir: './tests', testMatch: 'image-job-recovery.pw.mjs', workers: 1,
  outputDir: '.local/image-jobs-playwright', use: { baseURL: 'http://127.0.0.1:5188/studio/', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev --workspace @gouo/studio -- --port 5188 --strictPort', url: 'http://127.0.0.1:5188/studio/', reuseExistingServer: false },
})
