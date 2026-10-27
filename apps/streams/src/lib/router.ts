import type { MediaType } from './types';
import { isMediaType } from './types.ts';
import type { NavigationMotion } from './screen-transition';

export type Tab = 'home' | 'search' | 'library' | 'settings';
export type MediaRoute = {
  kind: 'detail' | 'streams' | 'player';
  type: MediaType;
  id: string;
  videoId?: string;
  season?: number;
  episode?: number;
};
export type AppRoute = MediaRoute
  | { kind: 'tab'; tab: Tab; query?: string; panel?: 'accounts' | 'addons' | 'playback' | 'integrations' }
  | { kind: 'catalog'; addonId: string; type: string; id: string };

const tabs = new Set(['home', 'search', 'library', 'settings']);

function coordinate(value: string | null): number | undefined {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

export function parseRoute(hash: string): AppRoute {
  try {
    const url = new URL(hash.replace(/^#/, '') || '/', 'https://routes.invalid');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return { kind: 'tab', tab: 'home' };
    if (parts[0] === 'catalog' && parts.length === 4) {
      return { kind: 'catalog', addonId: parts[1], type: parts[2], id: parts[3] };
    }
    if (isMediaType(parts[0]) && parts.length >= 2 && parts.length <= 3
      && (!parts[2] || ['streams', 'player'].includes(parts[2]))) {
      return { kind: parts[2] === 'player' ? 'player' : parts[2] === 'streams' ? 'streams' : 'detail',
        type: parts[0] as MediaType, id: parts[1], videoId: url.searchParams.get('video') || undefined,
        season: coordinate(url.searchParams.get('season')), episode: coordinate(url.searchParams.get('episode')) };
    }
    if (tabs.has(parts[0]) && (parts.length === 1 || (parts[0] === 'settings' && parts.length === 2
      && ['accounts', 'addons', 'playback', 'integrations'].includes(parts[1])))) {
      return { kind: 'tab', tab: parts[0] as Tab, query: parts[0] === 'search' ? url.searchParams.get('q') || undefined : undefined,
        panel: parts[1] as 'accounts' | 'addons' | 'playback' | 'integrations' | undefined };
    }
  } catch { /* Malformed links return to Home. */ }
  return { kind: 'tab', tab: 'home' };
}

export function routeHash(route: AppRoute): string {
  const params = new URLSearchParams();
  let path: string;
  if (route.kind === 'tab') {
    path = route.panel ? `/settings/${route.panel}` : '/';
  } else if (route.kind === 'catalog') {
    path = `/catalog/${[route.addonId, route.type, route.id].map(encodeURIComponent).join('/')}`;
  } else {
    path = `/${encodeURIComponent(route.type)}/${encodeURIComponent(route.id)}${route.kind === 'detail' ? '' : `/${route.kind}`}`;
    if (route.videoId) params.set('video', route.videoId);
    if (route.season !== undefined) params.set('season', String(route.season));
    if (route.episode !== undefined) params.set('episode', String(route.episode));
  }
  return `#${path}${params.size ? `?${params}` : ''}`;
}

type RootTabRoute = { kind: 'tab'; tab: Tab; query?: string };

type RouteState = { streamsRouter: 1; depth: number; parent?: string };

const BASE_HASH = routeHash({ kind: 'tab', tab: 'home' });

/** A bottom-tab destination, as opposed to a screen pushed on top of a tab. */
export function isRootTab(route: AppRoute): route is RootTabRoute {
  return route.kind === 'tab' && !route.panel;
}

// pushState gives Gecko, Safari, and browser Back the same navigation stack.
// Hash routes also work when the site is hosted without an SPA rewrite rule.
export class HashRouter {
  private lastHash: string;
  private changed: (route: AppRoute, motion: NavigationMotion) => void;
  private requestedBack = false;
  private rootTab: RootTabRoute = { kind: 'tab', tab: 'home' };
  private tabSelection: Promise<void> | null = null;
  private traversal: (() => void) | null = null;
  private previousScrollRestoration: ScrollRestoration;
  private onHistory = () => {
    if (this.traversal) {
      // An internal history.go() towards the root: settle it without showing intermediate screens.
      this.lastHash = window.location.hash;
      const settle = this.traversal;
      this.traversal = null;
      settle();
      return;
    }
    if (window.location.hash === this.lastHash) return; // popstate + hashchange can describe the same traversal.
    this.lastHash = window.location.hash;
    const motion = this.requestedBack ? 'back' : 'history';
    this.requestedBack = false;
    const route = parseRoute(this.lastHash);
    if (isRootTab(route) && this.lastHash === BASE_HASH) this.changed(this.rootTab, motion);
    else {
      this.rememberTab(route);
      this.replace(route);
      this.changed(route, motion);
    }
  };

  constructor(changed: (route: AppRoute, motion: NavigationMotion) => void) {
    this.changed = changed;
    this.lastHash = window.location.hash;
    this.previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.addEventListener('popstate', this.onHistory);
    window.addEventListener('hashchange', this.onHistory);
    const initial = parseRoute(this.lastHash);
    this.rememberTab(initial);
    if (initial.kind === 'tab' && initial.panel && this.state().depth === 0) {
      // A cold Settings panel link still has the Settings tab beneath it.
      history.replaceState({ streamsRouter: 1, depth: 0 } satisfies RouteState, '', BASE_HASH);
      history.pushState({ streamsRouter: 1, depth: 1, parent: BASE_HASH } satisfies RouteState, '', routeHash(initial));
    }
    this.replace(initial);
  }

  private rememberTab(route: AppRoute) {
    if (route.kind === 'tab') this.rootTab = { kind: 'tab', tab: route.tab, query: route.query };
  }

  private state(): RouteState {
    const state = history.state as Partial<RouteState> | null;
    return state?.streamsRouter === 1 && Number.isSafeInteger(state.depth) && state.depth! >= 0
      ? state as RouteState : { streamsRouter: 1, depth: 0 };
  }

  push(route: AppRoute) {
    if (isRootTab(route)) { void this.selectRootTab(route); return; }
    this.rememberTab(route);
    const hash = routeHash(route);
    if (hash === window.location.hash) return;
    const state: RouteState = { streamsRouter: 1, depth: this.state().depth + 1, parent: window.location.hash };
    history.pushState(state, '', hash);
    this.lastHash = hash;
    this.changed(route, 'push');
  }

  replace(route: AppRoute) {
    this.rememberTab(route);
    this.lastHash = routeHash(route);
    history.replaceState(this.state(), '', this.lastHash);
  }

  /** Tabs share the base entry; discard any pushed screens before selecting one. */
  async selectRootTab(route: RootTabRoute) {
    this.rootTab = route;
    if (this.tabSelection) return this.tabSelection;
    const { depth } = this.state();
    if (depth > 0) {
      this.tabSelection = this.traverse(-depth).then(() => {
        // replace() re-reads the actual depth; a timed-out traversal may still be on a pushed entry.
        this.replace(this.rootTab);
        this.changed(this.rootTab, 'history');
      }).finally(() => { this.tabSelection = null; });
      return this.tabSelection;
    }
    this.replace(route);
    this.changed(route, 'history');
  }

  private traverse(delta: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.traversal === finish) this.traversal = null;
        resolve();
      };
      this.traversal = finish;
      // Some engines omit history events; always let tab selection finish.
      const timer = setTimeout(finish, 500);
      history.go(delta);
    });
  }

  back(fallback: AppRoute) {
    if (this.state().depth > 0) { this.requestedBack = true; history.back(); }
    else { this.replace(fallback); this.changed(fallback, 'back'); }
  }

  parent(): AppRoute | null {
    const parent = this.state().parent;
    return parent ? parseRoute(parent) : null;
  }

  destroy() {
    window.removeEventListener('popstate', this.onHistory);
    window.removeEventListener('hashchange', this.onHistory);
    history.scrollRestoration = this.previousScrollRestoration;
  }
}
