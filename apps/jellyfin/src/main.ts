import { mount } from 'svelte';
import './app.css';
import { get } from 'svelte/store';
import { diagnosticLogs, activeCastPayload } from './lib/cast/playbridge';
import App from './App.svelte';
import {
  switchAccount,
  connectToJellyfinServer,
  serverConfig,
  activeTab,
  searchQuery,
  playMedia,
  stopPlayback,
  logout,
  playWithLinkedQueue,
  playFolderOrAlbumWithCast,
  playQueueTrack,
  playInBrowser,
  activePlayer,
  isQueueDrawerOpen,
  isLyricsOpen
} from './lib/stores/appState';

// Test-only hooks. Never assign window.playbridge — the native PlayBridge
// webview injects .cast / .linkCast / .capabilities on that name.
if (typeof window !== 'undefined') {
  (window as any).__bridgedTest = {
    ...(window as any).__bridgedTest,
    searchQuery,
    diagnostics: () => ({ logs: get(diagnosticLogs), payload: get(activeCastPayload) }),
    playMedia, stopPlayback, logout, playWithLinkedQueue, playFolderOrAlbumWithCast, playQueueTrack,
    switchAccount,
    connectToJellyfinServer,
    serverConfig,
    activeTab,
    playInBrowser,
    activePlayer,
    isQueueDrawerOpen,
    isLyricsOpen
  };
}

const app = mount(App, {
  target: document.getElementById('app')!
});

// Production builds cache only versioned app assets; Vite dev keeps hot reload untouched.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, { once: true });
}

export default app;
