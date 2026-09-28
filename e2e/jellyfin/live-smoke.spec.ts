import { test, expect } from '../fixtures';
import { connectLiveSession, openMusicLibrary, startMusicPlayback } from '../helpers/app';
import { liveSessionFromEnv } from '../helpers/session';

function requireLiveSession() {
  const session = liveSessionFromEnv();
  test.skip(!session, 'Set JELLYFIN_URL, JELLYFIN_TOKEN, and JELLYFIN_USER_ID to run live smoke tests');
  return session;
}

test.describe('Jellyfin live server', () => {
  test('connects and shows the home library', async ({ page }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    const tiles = page.locator('.library-tile-card');
    const cards = page.locator('.media-card');
    await expect(tiles.or(cards).first()).toBeVisible({ timeout: 20_000 });
  });

  test('opens a music library when one exists', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    expect(await page.locator('.media-card').count()).toBeGreaterThan(0);
  });

  test('starts playback from a music library', async ({ page, isMobile }) => {
    const session = requireLiveSession();
    if (!session) return;
    await connectLiveSession(page, session);
    test.skip(!(await openMusicLibrary(page, isMobile)), 'No Music library on this server');
    test.skip(!(await startMusicPlayback(page)), 'No Play control available');
    await expect(page.locator('.mini-player-bar, .player-overlay').first()).toBeVisible();
  });
});
