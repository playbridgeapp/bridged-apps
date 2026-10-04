import type { JellyfinItem, PreparedPlayback, ServerConfig } from '../types';
import { reportPlayback, type PlaybackReport } from './jellyfin';
import { addDiagnosticLog } from '../cast/playbridge';

/** Account and media identity are captured, never read from a later active account. */
export class PlaybackReporter {
  private started = false;
  private stopped = false;
  private lastSent = 0;
  private chain = Promise.resolve();
  private report: PlaybackReport;
  constructor(private config: ServerConfig, private item: JellyfinItem, prepared: PreparedPlayback, private onStopped?: () => void) {
    this.report = { ItemId: item.Id, MediaSourceId: prepared.mediaSourceId, PlaySessionId: prepared.playSessionId,
      PositionTicks: prepared.startPositionMs * 10000, IsPaused: false, PlayMethod: prepared.playMethod, CanSeek: true };
  }
  private send(event: 'start' | 'progress' | 'stop') {
    if (this.config.isDemo || !this.config.url) return;
    const snapshot = { ...this.report };
    this.chain = this.chain.then(() => reportPlayback(this.config.url, this.config.token, event, snapshot))
      .catch(() => { addDiagnosticLog('warn', 'Jellyfin watch-progress report failed.'); });
  }
  update(positionMs: number, paused: boolean, force = false): void {
    if (this.stopped || !Number.isFinite(positionMs) || positionMs < 0) return;
    const pauseChanged = this.report.IsPaused !== paused;
    this.report.PositionTicks = Math.round(positionMs * 10000);
    this.report.IsPaused = paused;
    if (!this.started) { this.started = true; this.send('start'); }
    this.item.UserData = { ...this.item.UserData, PlaybackPositionTicks: this.report.PositionTicks };
    if (force || pauseChanged || Date.now() - this.lastSent >= 10000) {
      this.lastSent = Date.now(); this.send('progress');
    }
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.started) {
      this.send('stop');
      void this.chain.then(() => this.onStopped?.());
    }
  }
}
