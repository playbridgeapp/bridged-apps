import { expect, test, type Page } from '@playwright/test';

async function goTab(page: Page, name: 'Home' | 'Search' | 'Library' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}
const current = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' }).locator('[aria-current="page"]');

test('switching tabs never stacks history: Back goes Home, then leaves', async ({ page }) => {
  await page.goto('/');
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  for (const tab of ['Search', 'Library', 'Settings', 'Search', 'Library'] as const) {
    await goTab(page, tab);
    await expect(current(page)).toHaveAttribute('aria-label', tab);
  }
  await page.goBack();
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  await expect(page).toHaveURL(/#\/$/);
  // Home is the first entry: Back leaves Streams (here, to the blank page the test started on).
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('going Home from a tab returns to the existing Home entry', async ({ page }) => {
  await page.goto('/');
  await goTab(page, 'Library');
  await goTab(page, 'Home');
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  await goTab(page, 'Settings');
  await page.goBack();
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

for (const [hash, tab] of [['#/library', 'Library'], ['#/search?q=film', 'Search'], ['#/settings', 'Settings']] as const) {
  test(`a fresh link into ${tab} goes Back to Home before leaving`, async ({ page }) => {
    await page.goto(`/${hash}`);
    await expect(current(page)).toHaveAttribute('aria-label', tab);
    await page.goBack();
    await expect(current(page)).toHaveAttribute('aria-label', 'Home');
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });
}

test('a deep-linked tab keeps its history shape across a reload', async ({ page }) => {
  await page.goto('/#/library');
  await page.reload();
  await expect(current(page)).toHaveAttribute('aria-label', 'Library');
  await page.goBack();
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('screens opened inside a tab still close with Back', async ({ page }) => {
  await page.goto('/');
  await goTab(page, 'Settings');
  await page.getByRole('button', { name: /Accounts and profiles/ }).click();
  await expect(page).toHaveURL(/#\/settings\/accounts$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(current(page)).toHaveAttribute('aria-label', 'Settings');
  await page.goBack();
  await expect(current(page)).toHaveAttribute('aria-label', 'Home');
});
