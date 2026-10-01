import { defineConfig } from '@playwright/test'

// UI work owns a separate frontend port; it never starts or stops the shared API.
// The browser cases supply explicit account/model fixtures and make no paid calls.
export default defineConfig({
  testDir: './tests', testIgnore: '**/stack/**', testMatch: '**/*.pw.mjs',
  outputDir: './output/ui-redesign/current',
  use: { baseURL: 'http://127.0.0.1:5186/studio/' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js apps/studio --host 127.0.0.1 --port 5186',
    url: 'http://127.0.0.1:5186/studio/', reuseExistingServer: false,
  },
})
