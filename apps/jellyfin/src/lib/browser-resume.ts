import type { PreparedPlayback } from './types';

type ResumeMedia = Pick<HTMLMediaElement, 'currentTime' | 'duration' | 'seeking' | 'getAttribute'>;

/** A queued Movi seek is not confirmed until the observed playback time matches. */
export class BrowserResume {
  private attempts = new WeakMap<ResumeMedia, { playback: PreparedPlayback; confirmed: boolean }>();
  private attempt(media: ResumeMedia, playback?: PreparedPlayback) {
    if (!playback || media.getAttribute('src') !== playback.url) return;
    let attempt = this.attempts.get(media);
    if (attempt?.playback !== playback) {
      attempt = { playback, confirmed: playback.startPositionMs <= 0 };
      this.attempts.set(media, attempt);
    }
    return attempt;
  }
  apply(media: ResumeMedia, playback?: PreparedPlayback): void {
    const attempt = this.attempt(media, playback);
    if (!attempt || this.observe(media, playback) || media.seeking) return;
    try { media.currentTime = attempt.playback.startPositionMs / 1000; }
    catch { /* The next readiness event can retry. */ }
  }
  observe(media: ResumeMedia, playback?: PreparedPlayback): boolean {
    const attempt = this.attempt(media, playback);
    if (!attempt) return false;
    if (!attempt.confirmed && !media.seeking && media.currentTime > 0
      && Math.abs(media.currentTime - attempt.playback.startPositionMs / 1000) <= 1) attempt.confirmed = true;
    return attempt.confirmed;
  }
}

/** Movi relays EOF itself, but not all of its internal native video's events. */
export function forwardNativeVideoEvents(host: EventTarget, video: HTMLVideoElement, isCurrent: () => boolean): () => void {
  const events = ['loadedmetadata', 'canplay', 'playing', 'seeked', 'timeupdate', 'pause'] as const;
  let active = true;
  const forward = (event: Event) => { if (active && isCurrent()) host.dispatchEvent(new Event(event.type)); };
  for (const type of events) video.addEventListener(type, forward);
  if (video.readyState >= 1) forward(new Event('loadedmetadata'));
  if (video.readyState >= 3) forward(new Event('canplay'));
  return () => { active = false; for (const type of events) video.removeEventListener(type, forward); };
}
