interface ResumeMedia {
  currentTime: number;
  duration: number;
  readonly seeking?: boolean;
  getAttribute(name: string): string | null;
}

interface ResumePlayback {
  stream: { url?: string };
  resumePositionMs: number;
}

interface ResumeAttempt {
  playback: ResumePlayback;
  applied: boolean;
}

/** Keep seek bookkeeping out of Svelte's reactive playback/source bindings. */
export class BrowserResume {
  private attempts = new WeakMap<ResumeMedia, ResumeAttempt>();

  private attempt(media: ResumeMedia, playback: ResumePlayback | null): ResumeAttempt | null {
    if (!playback || media.getAttribute('src') !== playback.stream.url) return null;
    const previous = this.attempts.get(media);
    if (previous?.playback === playback) return previous;
    const attempt = { playback, applied: !Number.isFinite(playback.resumePositionMs) || playback.resumePositionMs <= 0 };
    this.attempts.set(media, attempt);
    return attempt;
  }

  apply(media: ResumeMedia, playback: ResumePlayback | null): void {
    const attempt = this.attempt(media, playback);
    if (!attempt || this.observe(media, playback) || media.seeking) return;
    const seconds = attempt.playback.resumePositionMs / 1000;
    const duration = Number(media.duration);
    if (Number.isFinite(duration) && duration > 0 && seconds >= duration * .95) {
      attempt.applied = true;
      return;
    }
    try {
      media.currentTime = seconds;
      // A Movi setter can queue or asynchronously fail a seek. Confirm through
      // seeked/timeupdate, not by mutating the reactive playback object here.
    } catch { /* A later readiness event can retry the seek. */ }
  }

  observe(media: ResumeMedia, playback: ResumePlayback | null): boolean {
    const attempt = this.attempt(media, playback);
    if (!attempt || attempt.applied) return !!attempt;
    const position = Number(media.currentTime);
    const seconds = attempt.playback.resumePositionMs / 1000;
    if (!media.seeking && Number.isFinite(position) && position > 0 && Math.abs(position - seconds) <= 1) {
      attempt.applied = true;
    }
    return attempt.applied;
  }
}
