export type SubtitleCue = { start: number; end: number; text: string };

function timestamp(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length < 2 || parts.length > 3 || parts.at(-1)! >= 60 || (parts.length === 3 && parts[1] >= 60)) return NaN;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

export function parseSubtitles(source: string): SubtitleCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex((line) => /-->/.test(line));
    if (index < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const match = lines[index].match(/^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)/);
    if (!match) continue;
    const start = timestamp(match[1]);
    const end = timestamp(match[2]);
    // Text is rendered with textContent; provider markup never becomes page HTML.
    const text = lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (named[code.toLowerCase()]) return named[code.toLowerCase()];
      const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
    }).trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
  }
  if (!cues.length) throw new Error('No usable captions found. Choose a VTT or SRT subtitle.');
  return cues.sort((a, b) => a.start - b.start);
}

function vttTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function subtitlesVtt(cues: SubtitleCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`).join('\n\n')}\n`;
}

export async function loadSubtitleCues(url: string, signal: AbortSignal): Promise<SubtitleCue[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Subtitle returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('Subtitle file is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Subtitle body is unavailable.');
  const decoder = new TextDecoder();
  let source = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Subtitle file is too large.'); }
      source += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  return parseSubtitles(source + decoder.decode());
}

export function subtitleRenderer(cues: SubtitleCue[]) {
  let caption: HTMLDivElement | null = null;
  let delay = 0;
  let cursor = 0;
  let lastTime = -1;
  let text = '';
  return {
    configure() {}, pushPacket() {},
    mount(container: HTMLElement) {
      caption?.remove(); text = '';
      caption = document.createElement('div');
      caption.setAttribute('data-addon-caption', '');
      caption.style.cssText = 'position:absolute;bottom:8%;left:5%;right:5%;text-align:center;white-space:pre-line;pointer-events:none;color:white;font:600 clamp(16px,3vw,30px)/1.35 sans-serif;text-shadow:0 2px 4px black,0 0 3px black;';
      container.append(caption);
    },
    render(time: number) {
      const current = time - delay;
      if (current < lastTime) cursor = 0;
      while (cursor < cues.length && cues[cursor].end <= current) cursor++;
      const active: string[] = [];
      for (let index = cursor; index < cues.length && cues[index].start <= current; index++) {
        if (cues[index].end > current) active.push(cues[index].text);
      }
      const next = active.join('\n');
      if (caption && next !== text) { caption.textContent = next; text = next; }
      lastTime = current;
    },
    setDelay(seconds: number) { delay = seconds; cursor = 0; },
    clear() { if (caption) caption.textContent = ''; text = ''; cursor = 0; lastTime = -1; },
    destroy() { caption?.remove(); caption = null; }
  };
}
