import type { InstalledAddon, MetaPreview } from './types';

export const SEARCH_DEADLINE_MS = 8000;
export const SEARCH_BATCH_MS = 32;
export const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_QUERIES = 12;
const MAX_CACHE_ITEMS = 1200;
const MAX_CACHE_CHARACTERS = 1_000_000;

type Target = (signal: AbortSignal) => Promise<MetaPreview[]>;
export type SearchState = {
  items: MetaPreview[]; total: number; pending: number; failed: number; timedOut: number;
  cached: boolean; retained: number;
};
export const emptySearchState = (): SearchState => ({ items: [], total: 0, pending: 0, failed: 0, timedOut: 0, cached: false, retained: 0 });

/** Memory-only identity; never put tokens in this descriptor or log its value. */
export function searchScope(identity: unknown, addons: InstalledAddon[]): string {
  return JSON.stringify([identity, addons.map(a => [a.manifestUrl, a.enabled, a.disabledFeatures,
    a.manifest.version, a.manifest.types, a.manifest.resources, a.manifest.idPrefixes, a.manifest.catalogs])]);
}

const key = (item: MetaPreview) => JSON.stringify([item.type, item.id]);
type Entry = { items: MetaPreview[]; expires: number; characters: number };
type Run = { query: string; generation: number; controllers: AbortController[]; timers: ReturnType<typeof setTimeout>[];
  batch?: ReturnType<typeof setTimeout>; results: Map<number, MetaPreview[]>; order: string[]; seed: Map<string, MetaPreview>;
  state: SearchState };

/** One active query, with bounded session-only cache and same-query in-flight dedup. */
export class SearchSession {
  private scope = '';
  private generation = 0;
  private run?: Run;
  private cache = new Map<string, Entry>();

  private publish: (state: SearchState) => void;

  constructor(publish: (state: SearchState) => void) { this.publish = publish; }

  setScope(scope: string): boolean {
    if (scope === this.scope) return false;
    this.scope = scope;
    this.invalidate();
    return true;
  }

  invalidate(): void {
    this.cancel();
    this.cache.clear();
    this.publish(emptySearchState());
  }

  clear(): void {
    this.cancel();
    this.publish(emptySearchState());
  }

  private cancel(): void {
    this.generation++;
    const run = this.run;
    this.run = undefined;
    if (!run) return;
    clearTimeout(run.batch);
    run.timers.forEach(clearTimeout);
    run.controllers.forEach(c => c.abort());
  }

  private current(run: Run): boolean { return this.run === run && run.generation === this.generation; }

  search(query: string, targets: Target[]): void {
    query = query.trim();
    if (!query) { this.clear(); return; }
    // Repeated Enter/history activation joins the active refresh, rather than restarting it.
    if (this.run?.query === query) return;
    this.cancel();
    const now = Date.now();
    for (const [q, entry] of this.cache) if (entry.expires <= now) this.cache.delete(q);
    const cached = this.cache.get(query);
    if (cached) { this.cache.delete(query); this.cache.set(query, cached); }
    const items = cached ? structuredClone(cached.items) : [];
    const run: Run = { query, generation: this.generation, controllers: targets.map(() => new AbortController()), timers: [],
      results: new Map(), order: items.map(key), seed: new Map(items.map(item => [key(item), item])),
      state: { ...emptySearchState(), items, cached: !!cached, total: targets.length, pending: targets.length } };
    this.run = run;
    this.publish({ ...run.state });
    if (!this.current(run)) return;
    if (!targets.length) { this.run = undefined; return; }
    targets.forEach((load, index) => {
      let settled = false;
      const finish = (items?: MetaPreview[], failure?: 'failed' | 'timedOut') => {
        if (settled || !this.current(run)) return;
        settled = true;
        clearTimeout(run.timers[index]);
        run.state.pending--;
        if (failure) run.state[failure]++;
        else run.results.set(index, items || []);
        if (run.batch === undefined) run.batch = setTimeout(() => this.flush(run), SEARCH_BATCH_MS);
      };
      run.timers[index] = setTimeout(() => {
        // Settle even if an add-on/transport ignores AbortSignal.
        finish(undefined, 'timedOut');
        run.controllers[index].abort();
      }, SEARCH_DEADLINE_MS);
      Promise.resolve().then(() => this.current(run) ? load(run.controllers[index].signal) : [])
        .then(items => finish(items), () => finish(undefined, 'failed'));
    });
  }

  private flush(run: Run): void {
    if (!this.current(run)) return;
    run.batch = undefined;
    // Deterministic priority for duplicate fields, independent of response timing.
    // New positions append in publication order; targets ready in the same batch use
    // configured catalog/item order. Published positions never move or disappear.
    const fresh = new Map<string, MetaPreview>();
    for (const [, items] of [...run.results].sort(([a], [b]) => a - b)) for (const item of items) {
      const id = key(item), previous = fresh.get(id);
      if (!previous) fresh.set(id, item);
      else fresh.set(id, { ...item, ...Object.fromEntries(Object.entries(previous)
        .filter(([, value]) => value !== undefined && value !== '')) } as MetaPreview);
    }
    const seen = new Set(run.order);
    for (const id of fresh.keys()) if (!seen.has(id)) { run.order.push(id); seen.add(id); }
    run.state.items = run.order.map(id => fresh.get(id) || run.seed.get(id)!);
    run.state.retained = run.state.pending ? 0 : run.order.filter(id => !fresh.has(id)).length;
    const complete = !run.state.pending;
    if (complete && !run.state.failed && !run.state.timedOut) {
      // Only fresh, fully successful results enter the cache. Cached previews that
      // disappeared remain pinned in this view, but not in the next query snapshot.
      const authoritative = run.order.filter(id => fresh.has(id)).map(id => fresh.get(id)!);
      this.remember(run.query, authoritative);
    }
    this.publish({ ...run.state });
    if (complete && this.current(run)) this.run = undefined;
  }

  private remember(query: string, items: MetaPreview[]): void {
    // Do not keep a misleading truncated query snapshot; oversized results aren't cached.
    this.cache.delete(query);
    if (items.length > MAX_CACHE_ITEMS) return;
    const characters = query.length + JSON.stringify(items).length;
    if (characters > MAX_CACHE_CHARACTERS) return;
    // Copy previews so later consumers cannot mutate a completed cache entry.
    this.cache.set(query, { items: structuredClone(items), expires: Date.now() + SEARCH_CACHE_TTL_MS, characters });
    const overBudget = () => this.cache.size > MAX_CACHE_QUERIES
      || [...this.cache.values()].reduce((n, e) => n + e.items.length, 0) > MAX_CACHE_ITEMS
      || [...this.cache.values()].reduce((n, e) => n + e.characters, 0) > MAX_CACHE_CHARACTERS;
    while (overBudget()) this.cache.delete(this.cache.keys().next().value!);
  }
}
