type Event<T> = T & { event_id: number; operation: string };
type Snapshot<T> = { records: T[]; cursor: number | null; refreshedAt: number };
const PREFIX = 'bridged-streams.delta.v1.';
const FULL_REFRESH_MS = 10 * 60_000;

export function clearDeltaSnapshots(scope: string): void {
  for (const name of ['progress', 'watched']) {
    try { localStorage.removeItem(`${PREFIX}${name}:${scope}`); } catch { /* unavailable storage */ }
  }
}

export function clearAccountDeltaSnapshots(scopePrefix: string): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) if (key && ['progress', 'watched'].some((name) => key.startsWith(`${PREFIX}${name}:${scopePrefix}`))) localStorage.removeItem(key);
  } catch { /* unavailable storage */ }
}

export function updateDeltaSnapshot<T>(scope: string, name: 'progress' | 'watched', key: (item: T) => string,
  upserts: T[] = [], deleted: string[] = []): void {
  const storageKey = `${PREFIX}${name}:${scope}`;
  try {
    const snapshot = JSON.parse(localStorage.getItem(storageKey) || 'null') as Snapshot<T> | null;
    if (!Array.isArray(snapshot?.records)) return;
    const records = new Map(snapshot.records.filter((item) => !deleted.includes(key(item))).map((item) => [key(item), item]));
    for (const item of upserts) records.set(key(item), item);
    // Keep the cursor: the server's events, including our own writes, still get replayed.
    localStorage.setItem(storageKey, JSON.stringify({ ...snapshot, records: [...records.values()] }));
  } catch { /* server deltas recover a missed cache update */ }
}

export async function deltaSync<T>(scope: string, name: 'progress' | 'watched', api: {
  full(): Promise<T[]>; cursor(): Promise<number>; delta(cursor: number, limit: number): Promise<Event<T>[]>;
  key(item: T): string; valid(item: unknown): item is T;
}, forceFallback = true): Promise<T[]> {
  const storageKey = `${PREFIX}${name}:${scope}`;
  let cached: Snapshot<T> | null = null;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (value && Number.isFinite(value.refreshedAt) && Array.isArray(value.records) && value.records.every(api.valid)
      && (value.cursor === null || (Number.isSafeInteger(value.cursor) && value.cursor >= 0))) cached = value;
  } catch { /* full sync below */ }
  const save = (snapshot: Snapshot<T>) => {
    // Data and cursor commit together. A failed cache write must not advance a cursor.
    try { localStorage.setItem(storageKey, JSON.stringify(snapshot)); } catch { /* next call refetches */ }
    return snapshot.records;
  };
  if (cached?.cursor === null && !forceFallback && Date.now() - cached.refreshedAt < FULL_REFRESH_MS) return cached.records;
  let cursor = cached?.cursor ?? null;
  let records = cached?.records || [];
  if (cursor === null) {
    // Capture the cursor BEFORE the snapshot so concurrent writes are replayed.
    try { cursor = await api.cursor(); } catch { cursor = null; }
    records = await api.full();
    if (!Array.isArray(records) || !records.every(api.valid)) throw new Error('Nuvio returned invalid watching data.');
    if (cursor === null) return save({ records, cursor: null, refreshedAt: Date.now() });
  }
  const items = new Map(records.map((record) => [api.key(record), record]));
  try {
    for (let page = 0; page < 100; page++) {
      const events = await api.delta(cursor, 100);
      if (!Array.isArray(events)) throw new Error('Invalid Nuvio delta response.');
      for (const event of events) {
        if (!api.key(event) || !Number.isSafeInteger(event.event_id) || event.event_id <= cursor
          || !['delete', 'upsert', 'insert', 'update'].includes(event.operation?.toLowerCase())) {
          throw new Error('Invalid Nuvio delta event.');
        }
        if (event.operation.toLowerCase() === 'delete') items.delete(api.key(event));
        else {
          if (!api.valid(event)) throw new Error('Invalid Nuvio delta item.');
          items.set(api.key(event), event);
        }
        cursor = event.event_id;
      }
      if (events.length < 100) return save({ records: [...items.values()], cursor, refreshedAt: Date.now() });
    }
    throw new Error('Nuvio delta pagination limit exceeded.');
  } catch {
    // Old backends, expired cursors, and malformed responses retain a full-sync path.
    records = await api.full();
    if (!Array.isArray(records) || !records.every(api.valid)) throw new Error('Nuvio returned invalid watching data.');
    return save({ records, cursor: null, refreshedAt: Date.now() });
  }
}
