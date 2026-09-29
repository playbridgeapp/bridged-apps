export type PlaybackDiagnostic = {
  at: string;
  attempt: number;
  event: string;
  detail: string;
};

const STORAGE_KEY = 'bridged-streams.playback-diagnostics.v1';
const MAX_ENTRIES = 80;

// Error messages from browsers and media libraries can contain signed stream
// URLs. Keep useful failure text while removing URLs and credential-shaped data.
export function safeDiagnosticText(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '');
  return text
    .replace(/(?:https?:\/\/|blob:|data:)[^\s<>"'`]+/gi, '[URL]')
    .replace(/\bBearer\s+[^\s<>"']+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token]')
    .replace(/\b(auth(?:orization)?|token|key|password|secret|signature|sig)\s*[:=]\s*[^\s,;<>"']+/gi, '$1=[redacted]')
    .slice(0, 500);
}

export function readPlaybackDiagnostics(): PlaybackDiagnostic[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.slice(-MAX_ENTRIES).filter((item): item is PlaybackDiagnostic =>
      !!item && typeof item.at === 'string' && Number.isSafeInteger(item.attempt)
      && typeof item.event === 'string' && typeof item.detail === 'string')
      .map((item) => ({
        at: item.at.slice(0, 30),
        attempt: item.attempt,
        event: safeDiagnosticText(item.event).slice(0, 60),
        detail: safeDiagnosticText(item.detail)
      }));
  } catch { return []; }
}

export function appendPlaybackDiagnostic(
  entries: PlaybackDiagnostic[], attempt: number, event: string, detail = ''
): PlaybackDiagnostic[] {
  const next = [...entries, {
    at: new Date().toISOString(),
    attempt,
    event: safeDiagnosticText(event).slice(0, 60),
    detail: safeDiagnosticText(detail)
  }].slice(-MAX_ENTRIES);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { /* In-memory diagnostics still work when storage is unavailable. */ }
  return next;
}

export function clearPlaybackDiagnostics(): void {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { /* No stored history to clear. */ }
}
