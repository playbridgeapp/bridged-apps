import type { InstalledAddon, MetaPreview } from './types';

export const SEARCH_DEADLINE_MS = 8000;
export const SEARCH_BATCH_MS = 32;
export const SEARCH_SOURCE_DEBOUNCE_MS = 400;
export const SEARCH_INTERACTION_SETTLE_MS = 150;
export const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_QUERIES = 12;
const MAX_CACHE_ITEMS = 1200;
const MAX_CACHE_CHARACTERS = 1_000_000;

export type SearchTarget = (signal: AbortSignal) => Promise<MetaPreview[]>;
export type SearchState = {
  items: MetaPreview[]; total: number; pending: number; failed: number; timedOut: number;
  cached: boolean; queued: boolean;
};
export const emptySearchState = (): SearchState => ({ items: [], total: 0, pending: 0, failed: 0, timedOut: 0, cached: false, queued: false });

/** Memory-only source configuration. URLs may be private: never persist or log it. */
export function searchSources(addons: InstalledAddon[]): string {
  return JSON.stringify(addons.map(a => [a.manifestUrl, a.enabled, a.disabledFeatures,
    a.manifest.version, a.manifest.types, a.manifest.resources, a.manifest.idPrefixes, a.manifest.catalogs]));
}

const key = (item: MetaPreview) => JSON.stringify([item.type, item.id]);
type Entry = { items: MetaPreview[]; expires: number; characters: number };
type Run = { query: string; generation: number; controllers: AbortController[]; timers: ReturnType<typeof setTimeout>[];
  batch?: ReturnType<typeof setTimeout>; results: Map<number, MetaPreview[]>; order: string[]; seed: Map<string, MetaPreview>;
  state: SearchState };

/** One active query, with bounded session-only cache and same-query in-flight dedup. */
export class SearchSession {
  private identity = '';
  private sources = '';
  private submitted = '';
  private createTargets: (query: string) => SearchTarget[] = () => [];
  private sourceTimer?: ReturnType<typeof setTimeout>;
  private reconcileTimer?: ReturnType<typeof setTimeout>;
  private protectedThrough: number | null = null;
  private reconciliation?: { generation: number; items: MetaPreview[] };
  private state = emptySearchState();
  private generation = 0;
  private run?: Run;
  private cache = new Map<string, Entry>();

  private publish: (state: SearchState) => void;

  constructor(publish: (state: SearchState) => void) { this.publish = publish; }

  setIdentity(identity: string): boolean {
    if (identity === this.identity) return false;
    this.identity = identity;
    this.invalidate();
    return true;
  }

  /** Privacy boundaries clear immediately; manifest churn preserves the submitted intent. */
  configure(identity: string, sources: string, createTargets: (query: string) => SearchTarget[]): 'identity' | 'sources' | 'none' {
    this.createTargets = createTargets;
    if (this.setIdentity(identity)) { this.sources = sources; return 'identity'; }
    if (sources === this.sources) return 'none';
    this.sources = sources;
    this.cancel();
    this.cache.clear();
    if (!this.submitted) return 'sources';
    const generation = this.generation;
    this.emit({ ...this.state, pending: 0, failed: 0, timedOut: 0, queued: true, cached: false });
    this.sourceTimer = setTimeout(() => {
      this.sourceTimer = undefined;
      if (generation !== this.generation) return;
      this.start(this.submitted, this.createTargets(this.submitted), this.state.items);
    }, SEARCH_SOURCE_DEBOUNCE_MS);
    return 'sources';
  }

  invalidate(): void {
    this.protectedThrough = null;
    this.clear();
    this.cache.clear();
  }

  clear(): void {
    this.cancel();
    this.submitted = '';
    this.emit(emptySearchState());
  }

  private emit(state: SearchState): void { this.state = state; this.publish(state); }

  /** Keep only the prefix needed to avoid shifting the pressed/focused card.
   * Obsolete cards below that prefix can disappear even during interaction. */
  protectThrough(index: number | null): void {
    this.protectedThrough = index;
    clearTimeout(this.reconcileTimer);
    const reconciliation = this.reconciliation;
    if (!reconciliation) return;
    if (index !== null) { this.reconcile(reconciliation); return; }
    // Let pointerup/click finish before removing their target.
    this.reconcileTimer = setTimeout(() => this.reconcile(reconciliation), SEARCH_INTERACTION_SETTLE_MS);
  }

  private reconcile(reconciliation: { generation: number; items: MetaPreview[] }): void {
    if (this.reconciliation !== reconciliation || reconciliation.generation !== this.generation) return;
    const fresh = new Set(reconciliation.items.map(key));
    const items = this.state.items.filter((item, i) => fresh.has(key(item))
      || (this.protectedThrough !== null && i <= this.protectedThrough));
    if (items.length === reconciliation.items.length) this.reconciliation = undefined;
    this.emit({ ...this.state, items });
  }

  private cancel(): void {
    this.generation++;
    clearTimeout(this.sourceTimer);
    clearTimeout(this.reconcileTimer);
    this.reconciliation = undefined;
    const run = this.run;
    this.run = undefined;
    if (!run) return;
    clearTimeout(run.batch);
    run.timers.forEach(clearTimeout);
    run.controllers.forEach(c => c.abort());
  }

  private current(run: Run): boolean { return this.run === run && run.generation === this.generation; }

  search(query: string, targets = this.createTargets(query.trim())): void {
    query = query.trim();
    if (!query) { this.clear(); return; }
    if (this.run?.query === query) return;
    const seed = query === this.submitted && this.state.queued ? this.state.items : undefined;
    this.submitted = query;
    this.start(query, targets, seed);
  }

  private start(query: string, targets: SearchTarget[], seed?: MetaPreview[]): void {
    this.cancel();
    const now = Date.now();
    for (const [q, entry] of this.cache) if (entry.expires <= now) this.cache.delete(q);
    const cached = this.cache.get(query);
    if (cached) { this.cache.delete(query); this.cache.set(query, cached); }
    const items = seed ?? (targets.length && cached ? structuredClone(cached.items) : []);
    const run: Run = { query, generation: this.generation, controllers: targets.map(() => new AbortController()), timers: [],
      results: new Map(), order: items.map(key), seed: new Map(items.map(item => [key(item), item])),
      state: { ...emptySearchState(), items, cached: !!cached, total: targets.length, pending: targets.length } };
    this.run = run;
    this.emit({ ...run.state });
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
    const complete = !run.state.pending;
    if (complete && !run.state.failed && !run.state.timedOut) {
      // Successful refreshes reconcile to fresh matches, with only an interaction
      // prefix temporarily pinned. Cache membership is always exactly fresh.
      const authoritative = run.order.filter(id => fresh.has(id)).map(id => fresh.get(id)!);
      this.remember(run.query, authoritative);
      if (this.protectedThrough === null) run.state.items = authoritative;
      else {
        run.state.items = run.state.items.filter((item, i) => fresh.has(key(item)) || i <= this.protectedThrough!);
        if (run.state.items.length !== authoritative.length) this.reconciliation = { generation: this.generation, items: authoritative };
      }
    }
    this.emit({ ...run.state });
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
