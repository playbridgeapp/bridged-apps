import { defineConfig } from '@playwright/test';

// The service worker only registers in production builds, so this suite runs against `vite preview`.
export default defineConfig({
  testDir: './streams-sw',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5183', browserName: 'chromium', serviceWorkers: 'allow' },
  webServer: {
    command: 'pnpm --filter @bridged-apps/streams build && pnpm --filter @bridged-apps/streams exec vite preview --host 127.0.0.1 --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 180_000
  }
});
