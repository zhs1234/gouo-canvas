import { defineConfig } from '@playwright/test'

// Full fixture browser suite. Never reuse another workspace's server or
// forward an unmatched test request to a user's Native/business API.
export default defineConfig({
  testDir: './tests', testIgnore: '**/stack/**', testMatch: '**/*.pw.mjs',
  outputDir: './output/playwright/isolated',
  use: { baseURL: 'http://127.0.0.1:5187/studio/' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js apps/studio --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187/studio/', reuseExistingServer: false,
    env: { GOUO_BACKEND_DEV_TARGET: 'http://127.0.0.1:1', GOUO_STUDIO_DEV_TARGET: 'http://127.0.0.1:1' },
  },
})
