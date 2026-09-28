import { test as base } from '@playwright/test';
import { connectBrowser, shouldUseObscura } from './helpers/cdp';

/**
 * Same Playwright fixtures (`page`, `context`, …) as the default test,
 * but the browser is either stock Chromium or Obscura over CDP.
 */
export const test = base.extend({
  browser: async ({}, use) => {
    const { browser, cleanup } = await connectBrowser();
    await use(browser);
    await cleanup();
  }
});

export { expect } from '@playwright/test';
export { shouldUseObscura };
