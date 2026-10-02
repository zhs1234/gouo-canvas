import { defineConfig } from '@playwright/test'

// This fixture-only frontend owns its port and never starts the business API.
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/chat-creation.pw.mjs', '**/chat-lab.pw.mjs'],
  outputDir: './output/playwright/chat-creation',
  use: { baseURL: 'http://127.0.0.1:5190/studio/' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js apps/studio --host 127.0.0.1 --port 5190',
    url: 'http://127.0.0.1:5190/studio/',
    reuseExistingServer: false,
    // Unmatched fixture reads must never reach a daily Native/API instance.
    env: { GOUO_BACKEND_DEV_TARGET: 'http://127.0.0.1:1', GOUO_STUDIO_DEV_TARGET: 'http://127.0.0.1:1' },
  },
})
