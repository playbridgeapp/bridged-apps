import { InvidiousApi } from './api.ts';
import { clearToken, loadToken, saveToken, type StoredToken } from './auth.ts';
import { chooseDestination, currentDestination, destinationsSupported } from './bridge.ts';
import { apiBase, savedInstance, saveInstance } from './instance.ts';
import { loadAutoplay, ProgressStore, saveAutoplay } from './playback.ts';
import type { PlaybackDestination } from './types';

declare const __INVIDIOUS_PROXY_TARGET__: string;
export const RELAY_TARGET = typeof __INVIDIOUS_PROXY_TARGET__ === 'string' ? __INVIDIOUS_PROXY_TARGET__ : '';

class AppState {
  instance = $state(savedInstance(RELAY_TARGET));
  token = $state<StoredToken | null>(null);
  destination = $state<PlaybackDestination | null>(null);
  subscriptions = $state<Set<string>>(new Set());
  toast = $state('');
  autoplay = $state(loadAutoplay());
  readonly progress = new ProgressStore();
  api = $state(new InvidiousApi(''));
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.useInstance(this.instance, false);
  }

  get signedIn(): boolean {
    return !!this.token;
  }

  useInstance(origin: string, persist = true): void {
    if (persist) saveInstance(origin);
    this.instance = origin;
    this.token = origin ? loadToken(origin) : null;
    this.api = new InvidiousApi(origin ? apiBase(origin, location.origin, RELAY_TARGET) : '', this.token?.token ?? null);
    this.subscriptions = new Set();
    if (this.token) void this.refreshSubscriptions();
  }

  acceptToken(raw: string): boolean {
    const stored = saveToken(this.instance, raw);
    if (!stored) return false;
    this.token = stored;
    this.api.setToken(stored.token);
    void this.refreshSubscriptions();
    return true;
  }

  /** Picks up a sign-in finished in another tab of this browser. */
  reloadToken(): void {
    const stored = loadToken(this.instance);
    if (stored?.token === this.token?.token) return;
    this.token = stored;
    this.api.setToken(stored?.token ?? null);
    this.subscriptions = new Set();
    if (stored) void this.refreshSubscriptions();
  }

  async signOut(): Promise<void> {
    const session = this.token?.session;
    if (session) await this.api.revoke(session).catch(() => {});
    clearToken();
    this.token = null;
    this.api.setToken(null);
    this.subscriptions = new Set();
  }

  async refreshSubscriptions(): Promise<void> {
    try {
      const list = await this.api.subscriptions();
      this.subscriptions = new Set(list.map((channel) => channel.authorId));
    } catch (error) {
      if ((error as { status?: number }).status === 403) this.expireToken();
    }
  }

  expireToken(): void {
    clearToken();
    this.token = null;
    this.api.setToken(null);
    this.showToast('Your sign-in expired. Sign in again from Settings.');
  }

  async setSubscribed(channelId: string, subscribed: boolean): Promise<void> {
    await this.api.subscribe(channelId, subscribed);
    const next = new Set(this.subscriptions);
    if (subscribed) next.add(channelId); else next.delete(channelId);
    this.subscriptions = next;
  }

  async refreshDestination(): Promise<void> {
    if (!destinationsSupported()) { this.destination = null; return; }
    try { this.destination = await currentDestination(); } catch { /* Keep the last known destination. */ }
  }

  async pickDestination(local = false): Promise<PlaybackDestination> {
    const destination = await chooseDestination(local);
    this.destination = destination;
    return destination;
  }

  setAutoplay(enabled: boolean): void {
    this.autoplay = enabled;
    saveAutoplay(enabled);
  }

  showToast(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = ''; }, 5000);
  }
}

export const app = new AppState();
