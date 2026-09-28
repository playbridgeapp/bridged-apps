import { test, expect } from '../fixtures';
import {
  connectLiveSession,
  expandAudioHud,
  expectAudioPlaying,
  expectAudioStopped,
  openMusicLibrary,
  readOverflow,
  startMusicPlayback
} from '../helpers/app';
import { liveSessionBFromEnv, liveSessionFromEnv } from '../helpers/session';

function requireLiveSession() {
  const session = liveSessionFromEnv();
  test.skip(!session, 'Set JELLYFIN_URL, JELLYFIN_TOKEN, and JELLYFIN_USER_ID to run live player tests');
  return session;
}

test.describe('Jellyfin live audio player', () => {
  test('plays audio after a full page refresh', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.brand-name')).toHaveText('PlayBridge', { timeout: 20_000 });
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');
    await expectAudioPlaying(page);
  });

  test('stops audio when switching to another server', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    const other = liveSessionBFromEnv();
    test.skip(!session || !other, 'Set JELLYFIN_B_URL, JELLYFIN_B_TOKEN, and JELLYFIN_B_USER_ID');
    if (!session || !other) return;
    test.skip(session.id === other.id, 'JELLYFIN_B_* must be a different server/user');

    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');
    await expectAudioPlaying(page);

    await page.evaluate(async (s) => {
      const hooks = (
        window as unknown as {
          __bridgedTest: { switchAccount: (account: typeof s) => Promise<void> };
        }
      ).__bridgedTest;
      await hooks.switchAccount(s);
    }, other);

    await expectAudioStopped(page);
    await expect(page.locator('.brand-name')).toHaveText('PlayBridge');
  });

  test('expands the audio HUD, ellipsizes long titles, and minimizes', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');

    await expect(page.locator('.mini-player-bar')).toBeVisible();
    const miniTitle = await readOverflow(page, '.mini-title');
    expect(miniTitle.textOverflow).toBe('ellipsis');
    expect(miniTitle.whiteSpace).toBe('nowrap');

    await expandAudioHud(page);
    await expect(page.locator('.audio-title')).toBeVisible();
    const hudTitle = await readOverflow(page, '.audio-title');
    expect(hudTitle.textOverflow).toBe('ellipsis');
    expect(hudTitle.overflow).toMatch(/hidden/);

    await page.getByTitle('Minimize to mini-player (keep browsing)').click();
    await expect(page.locator('.mini-player-bar')).toBeVisible();
    await expect(page.locator('.player-overlay')).toHaveCount(0);
  });

  test('queue drawer stacks above the expanded player', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');
    await expandAudioHud(page);

    const queueBtn = page.locator('.quick-bar-btn').filter({ hasText: /Up Next/i });
    await expect(queueBtn).toBeVisible();
    await queueBtn.click();

    const drawer = page.locator('.drawer-backdrop');
    await expect(drawer).toBeVisible();
    await expect(page.locator('.drawer-panel')).toBeVisible();
    await expect(page.locator('.player-overlay')).toBeVisible();

    const z = await page.evaluate(() => {
      const d = document.querySelector('.drawer-backdrop');
      const p = document.querySelector('.player-overlay');
      if (!d || !p) return null;
      return {
        drawer: Number(getComputedStyle(d).zIndex),
        player: Number(getComputedStyle(p).zIndex)
      };
    });
    expect(z).not.toBeNull();
    expect(z!.drawer).toBeGreaterThan(z!.player);

    const panelBox = await page.locator('.drawer-panel').boundingBox();
    expect(panelBox).not.toBeNull();
    if (isMobile) {
      expect(panelBox!.width).toBeGreaterThan(300);
    } else {
      expect(panelBox!.x).toBeGreaterThan(700);
    }

    await page.getByRole('button', { name: 'Close queue' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.locator('.audio-hud-container')).toBeVisible();
  });

  test('lyrics tab opens from the audio HUD', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');
    await expandAudioHud(page);

    await page.locator('.quick-bar-btn').filter({ hasText: 'Lyrics' }).click();
    await expect(page.locator('.drawer-panel')).toBeVisible();
    await expect(page.locator('.tab-btn.active')).toContainText(/Lyrics/i);
    await expect(page.locator('.lyrics-container')).toBeVisible();
    await expect(page.locator('.lyrics-line, .plain-lyrics, .empty-lyrics').first()).toBeVisible();
  });

  test('audio HUD layout screenshot', async ({ page, isMobile }) => {
    test.skip(!!process.env.CI, 'Screenshot baselines are darwin-only so far');
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');
    await expandAudioHud(page);

    await expect(page).toHaveScreenshot('live-audio-hud.png', {
      animations: 'disabled',
      caret: 'hide',
      mask: [
        page.locator('.audio-artwork-wrapper'),
        page.locator('.audio-bg-blur'),
        page.locator('.audio-title'),
        page.locator('.playing-title')
      ],
      maxDiffPixelRatio: 0.05
    });
  });
});
