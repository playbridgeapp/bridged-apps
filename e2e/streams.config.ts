import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './streams',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5182', browserName: 'chromium' },
  webServer: {
    command: 'pnpm dev:streams',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
