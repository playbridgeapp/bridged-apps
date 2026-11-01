import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './streams',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5182',
    browserName: 'chromium',
    // A browser with no saved addon list gets Cinemeta by default; specs start from an explicit empty list
    // so they never reach the real addon. default-addons.spec.ts covers the default itself.
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5182', localStorage: [{ name: 'bridged-streams.addons.v1', value: '[]' }] }] }
  },
  webServer: {
    command: 'pnpm dev:streams',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
