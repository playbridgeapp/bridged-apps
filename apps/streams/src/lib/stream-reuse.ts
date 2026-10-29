import CryptoJS from 'crypto-js';
import type { Stream } from './types';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type StreamFingerprint = { addonUrl: string; name: string; title: string; bingeGroup: string; urlHash: string };
type Link = { key: string; timestamp: number; fingerprint: StreamFingerprint };
type Group = { key: string; timestamp: number; value: string };
export const REUSE_KEY = 'bridged-streams.stream-reuse.v1';
const LIMIT = 100;
const label = (value?: string) => (value || '').replace(/https?:\/\/\S+/gi, '[link]').slice(0, 1000);

export function streamFingerprint(stream: Stream): StreamFingerprint {
  return { addonUrl: stream.addonUrl, name: label(stream.name), title: label(stream.title),
    bingeGroup: label(stream.behaviorHints?.bingeGroup), urlHash: CryptoJS.SHA256(stream.url || '').toString() };
}
export function matchesFingerprint(stream: Stream, fingerprint: StreamFingerprint): boolean {
  const current = streamFingerprint(stream);
  return Object.keys(current).every((key) => current[key as keyof StreamFingerprint] === fingerprint[key as keyof StreamFingerprint]);
}
export const streamContentKey = (type: string, id: string, videoId?: string) => `${type}:${id}${videoId ? `:${videoId}` : ''}`;

/** Only the current account/profile is retained, with no media URL or headers. */
export class StreamReuseStore {
  private scope = '';
  private links: Link[] = [];
  private groups: Group[] = [];
  private storage?: StorageLike;
  private clock: () => number;
  constructor(storage?: StorageLike, clock: () => number = Date.now) { this.storage = storage; this.clock = clock; }
  useScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope; this.links = []; this.groups = [];
    try {
      const saved = JSON.parse(this.storage?.getItem(REUSE_KEY) || 'null');
      if (saved?.scope === scope && Array.isArray(saved.links) && Array.isArray(saved.groups)) {
        this.links = saved.links.filter((link: Link) => typeof link?.key === 'string' && Number.isFinite(link.timestamp)
          && link.fingerprint && Object.keys(link.fingerprint).sort().join() === 'addonUrl,bingeGroup,name,title,urlHash'
          && Object.values(link.fingerprint).every((value) => typeof value === 'string') && /^[a-f0-9]{64}$/.test(link.fingerprint.urlHash)).slice(-LIMIT);
        this.groups = saved.groups.filter((group: Group) => typeof group?.key === 'string' && typeof group.value === 'string' && Number.isFinite(group.timestamp)).slice(-LIMIT);
      }
    } catch { /* Start empty after invalid/unavailable browser storage. */ }
    this.save();
  }
  clear(): void { this.links = []; this.groups = []; this.save(); }
  lastLink(key: string, hours: number): StreamFingerprint | undefined {
    const now = this.clock();
    this.links = this.links.filter((link) => link.timestamp <= now && now - link.timestamp < hours * 3_600_000);
    this.save();
    return this.links.find((link) => link.key === key)?.fingerprint;
  }
  bingeGroup(series: string): string | undefined { return this.groups.find((group) => group.key === series)?.value; }
  remember(scope: string, key: string, stream: Stream, series?: string, links = true, groups = true): void {
    if (!scope || scope !== this.scope) return; // Fence late playback callbacks from an old profile.
    const timestamp = this.clock();
    if (links) this.links = [...this.links.filter((link) => link.key !== key), { key, timestamp, fingerprint: streamFingerprint(stream) }].slice(-LIMIT);
    const group = label(stream.behaviorHints?.bingeGroup);
    if (groups && series && group) this.groups = [...this.groups.filter((entry) => entry.key !== series), { key: series, timestamp, value: group }].slice(-LIMIT);
    this.save();
  }
  private save(): void {
    try { this.storage?.setItem(REUSE_KEY, JSON.stringify({ scope: this.scope, links: this.links, groups: this.groups })); }
    catch { /* Reuse remains bounded in memory when storage is unavailable. */ }
  }
}
