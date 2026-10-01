import type { InstalledAddon } from './types';
import { resourceUrl, supports } from './addons';

export type AddonSubtitle = { id: string; url: string; language: string; label: string };
export { parseSubtitles, subtitlesVtt, loadSubtitleCues, subtitleRenderer } from './subtitle-cues.ts';

export async function fetchAddonSubtitles(addons: InstalledAddon[], type: string, id: string, signal: AbortSignal): Promise<{ tracks: AddonSubtitle[]; errors: string[] }> {
  const candidates = addons.filter((addon) => supports(addon, 'subtitles', type, id));
  const tracks: AddonSubtitle[] = [];
  const errors: string[] = [];
  let next = 0;
  async function worker() {
    while (next < candidates.length && !signal.aborted) {
      const addon = candidates[next++];
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 10_000);
      try {
        const response = await fetch(resourceUrl(addon, 'subtitles', type, id), { signal: controller.signal });
        if (!response.ok) throw new Error('Subtitle lookup failed.');
        const json = await response.json();
        if (!Array.isArray(json.subtitles)) throw new Error('Invalid subtitle response.');
        for (const item of json.subtitles.slice(0, 200)) {
          try {
            const url = new URL(item.url);
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
            const language = String(item.lang || item.language || 'und').slice(0, 32);
            tracks.push({ id: `${addon.manifestUrl}:${language}:${url.href}`, url: url.href, language,
              label: `${language} · ${addon.manifest.name}${item.title ? ` · ${String(item.title).slice(0, 120)}` : ''}` });
          } catch { /* invalid provider entry */ }
        }
      } catch { if (!signal.aborted) errors.push(`${addon.manifest.name}: subtitles unavailable in this browser.`); }
      finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { tracks: [...new Map(tracks.map((track) => [`${track.language}:${track.url}`, track])).values()], errors };
}

