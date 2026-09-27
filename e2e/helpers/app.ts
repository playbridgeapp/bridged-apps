import { expect, type Page } from '@playwright/test';
import type { LiveSession } from './session';

export async function openApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'PlayBridge Jellyfin' })).toBeVisible({
    timeout: 15_000
  });
}

export async function enterDemoLibrary(page: Page): Promise<void> {
  await openApp(page);
  await page.getByRole('button', { name: /Explore with Demo Library/i }).click();
  await expect(page.locator('.brand-name')).toHaveText('PlayBridge', { timeout: 15_000 });
  await expect(page.locator('.media-card').first()).toBeVisible({ timeout: 15_000 });
}

type BridgedTestHooks = {
  switchAccount: (account: LiveSession) => Promise<void>;
};

export async function connectLiveSession(page: Page, session: LiveSession): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean((window as unknown as { __bridgedTest?: BridgedTestHooks }).__bridgedTest?.switchAccount),
    { timeout: 10_000 }
  );
  await page.evaluate(async (s) => {
    const hooks = (window as unknown as { __bridgedTest: BridgedTestHooks }).__bridgedTest;
    await hooks.switchAccount(s);
  }, session);
  await expect(page.locator('.brand-name')).toHaveText('PlayBridge', { timeout: 20_000 });
}

export function chromeButton(page: Page, isMobile: boolean, name: string | RegExp) {
  return isMobile
    ? page.locator('.mobile-bottom-nav').getByRole('button', { name })
    : page.locator('.nav-links').getByRole('button', { name });
}

export async function openMusicLibrary(page: Page, isMobile: boolean): Promise<boolean> {
  const nav = chromeButton(page, isMobile, isMobile ? 'Music' : /music/i);
  const tile = page.locator('.library-tile-card').filter({ hasText: /music/i }).first();
  if (await nav.isVisible().catch(() => false)) {
    await nav.click();
  } else if (await tile.isVisible().catch(() => false)) {
    await tile.click();
  } else {
    return false;
  }
  await expect(page.locator('.media-card').first()).toBeVisible({ timeout: 20_000 });
  return true;
}

export async function startMusicPlayback(page: Page): Promise<boolean> {
  const playAll = page.locator('.batch-cast-actions').getByRole('button', { name: 'Play', exact: true });
  if (await playAll.isVisible().catch(() => false)) {
    await playAll.click();
  } else {
    await page.locator('.media-card .card-title').first().click();
    const modalPlay = page.locator('.modal-container').getByRole('button', { name: /^Play/ });
    if (!(await modalPlay.isVisible().catch(() => false))) return false;
    await modalPlay.click();
  }
  await expect(page.locator('.mini-player-bar, .player-overlay').first()).toBeVisible({
    timeout: 15_000
  });
  return true;
}

export async function expectAudioPlaying(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => [...document.querySelectorAll('audio')].some((a) => !a.paused)),
      { timeout: 15_000 }
    )
    .toBe(true);
}

export async function expectAudioStopped(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => [...document.querySelectorAll('audio')].every((a) => a.paused)),
      { timeout: 10_000 }
    )
    .toBe(true);
  await expect(page.locator('.mini-player-bar, .player-overlay')).toHaveCount(0);
}

export async function expandAudioHud(page: Page): Promise<void> {
  if (await page.locator('.audio-hud-container').isVisible().catch(() => false)) return;
  await expect(page.locator('.mini-player-bar')).toBeVisible();
  const expand = page.locator('.mini-expand-btn');
  // Mobile hides the chevron; controls stopPropagation so the bar center is Pause/Skip.
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
  } else {
    await page.locator('.mini-player-bar .mini-left').click();
  }
  await expect(page.locator('.player-overlay')).toBeVisible();
  await expect(page.locator('.audio-hud-container')).toBeVisible();
}

export async function readOverflow(page: Page, selector: string): Promise<{
  overflow: string;
  textOverflow: string;
  whiteSpace: string;
}> {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      overflow: cs.overflow,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace
    };
  });
}

export async function readThemeTokens(page: Page): Promise<{
  primaryAccent: string;
  bgBase: string;
  bgSurface: string;
}> {
  return page.evaluate(() => {
    const computed = getComputedStyle(document.documentElement);
    return {
      primaryAccent: computed.getPropertyValue('--theme-primary-accent').trim(),
      bgBase: computed.getPropertyValue('--bg-base').trim(),
      bgSurface: computed.getPropertyValue('--bg-surface').trim()
    };
  });
}
