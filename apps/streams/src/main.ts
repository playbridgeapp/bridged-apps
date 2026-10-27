import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });

// Production builds cache the public shell and versioned assets; Vite dev keeps hot reload untouched.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const UPDATE_CHECK_INTERVAL_MS = 60_000;
    const RETURN_RELOAD_WINDOW_MS = 3_000;
    const RELOADED_VERSIONS_KEY = 'bridged-streams.shell-reloads.v1';
    const versionedAsset = /^\/assets\/[^/?]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|woff2?|png|jpe?g|webp|avif|svg)$/;
    const loadedVersion = [...new Set([...document.querySelectorAll('script[src], link[href]')]
      .map((element) => element.getAttribute('src') || element.getAttribute('href') || '')
      .filter((path) => versionedAsset.test(path)))].sort().join('\n');
    let pendingVersion: string | null = null;
    let wasHidden = document.visibilityState === 'hidden';
    let lastUpdateCheck = 0;
    let returnedAt: number | null = null;
    const reloadedVersions = new Set<string>();
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(RELOADED_VERSIONS_KEY) || '[]');
      if (Array.isArray(saved)) for (const version of saved) if (typeof version === 'string') reloadedVersions.add(version);
    } catch { /* Storage may be unavailable. */ }
    function reloadPendingShell(): boolean {
      if (!pendingVersion || reloadedVersions.has(pendingVersion)) return false;
      // Persist before reloading so a slow/offline reload cannot loop on the old shell.
      try { sessionStorage.setItem(RELOADED_VERSIONS_KEY, JSON.stringify([...reloadedVersions, pendingVersion])); }
      catch { return false; }
      reloadedVersions.add(pendingVersion);
      returnedAt = null;
      location.reload();
      return true;
    }
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(type, () => { returnedAt = null; }, { capture: true, passive: true });
    }
    navigator.serviceWorker.addEventListener('message', (event) => {
      const assets: unknown = event.data?.assets;
      if (event.data?.type !== 'shell-updated' || !Array.isArray(assets) || !assets.length
        || !assets.every((path) => typeof path === 'string' && versionedAsset.test(path))) return;
      const version = [...new Set(assets)].sort().join('\n');
      pendingVersion = version !== loadedVersion ? version : null;
      if (document.visibilityState === 'visible' && returnedAt !== null
        && performance.now() - returnedAt <= RETURN_RELOAD_WINDOW_MS) reloadPendingShell();
    });
    const registration = navigator.serviceWorker.register('/sw.js');
    void registration.catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') { wasHidden = true; returnedAt = null; return; }
      const returning = wasHidden;
      if (returning) returnedAt = performance.now();
      wasHidden = false;
      if (returning && reloadPendingShell()) return;
      const now = Date.now();
      if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastUpdateCheck = now;
      void registration.then((value) => {
        void value.update().catch(() => {});
        value.active?.postMessage({ type: 'check-shell-update' });
      }).catch(() => {});
    });
  }, { once: true });
}
