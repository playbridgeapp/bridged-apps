// Native Nuvio scrapers sometimes copy a complete HTTP client's headers into
// stream results. The browser/receiver controls these transport and request
// context headers itself; they are not provider authentication requirements.
const CLIENT_HEADERS = new Set([
  'accept-encoding', 'connection', 'content-length', 'dnt', 'host', 'keep-alive',
  'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

export function normalizePluginHeaders(value: unknown): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Scraper returned invalid playback headers.');
  const headers: [string, string][] = [];
  for (const [name, content] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof content !== 'string' || /[\u0000-\u001f\u007f]/.test(content)) {
      throw new Error('Scraper returned invalid playback headers.');
    }
    const lower = name.toLowerCase();
    if (!CLIENT_HEADERS.has(lower) && !lower.startsWith('sec-fetch-')) headers.push([name, content]);
  }
  return headers.length ? Object.fromEntries(headers) : undefined;
}
