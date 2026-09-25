import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node scripts/dev-server.mjs',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000
    },
    {
      command: 'BASE_PATH=/life-balance/ node scripts/build.mjs && BASE_PATH=/life-balance/ node scripts/dev-server.mjs dist 4173',
      url: 'http://127.0.0.1:4173/life-balance/',
      timeout: 15_000
    }
  ]
});
