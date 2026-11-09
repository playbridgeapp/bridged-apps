export interface Thumbnail {
  quality?: string;
  url: string;
  width?: number;
  height?: number;
}

export interface VideoSummary {
  type?: 'video';
  videoId: string;
  title: string;
  author: string;
  authorId: string;
  lengthSeconds: number;
  viewCount?: number;
  viewCountText?: string;
  publishedText?: string;
  liveNow?: boolean;
  isUpcoming?: boolean;
  videoThumbnails?: Thumbnail[];
}

export interface ChannelSummary {
  type: 'channel';
  author: string;
  authorId: string;
  authorThumbnails?: Thumbnail[];
  subCount?: number;
  videoCount?: number;
  description?: string;
}

export interface PlaylistSummary {
  type: 'playlist';
  title: string;
  playlistId: string;
  author: string;
  authorId?: string;
  videoCount: number;
  playlistThumbnail?: string;
  videos?: VideoSummary[];
}

export type SearchResult = (VideoSummary & { type: 'video' }) | ChannelSummary | PlaylistSummary;

export interface Caption {
  label: string;
  language_code: string;
  url: string;
}

export interface FormatStream {
  url: string;
  itag: string;
  type?: string;
  qualityLabel?: string;
}

export interface VideoDetails extends VideoSummary {
  description?: string;
  descriptionHtml?: string;
  likeCount?: number;
  subCountText?: string;
  authorThumbnails?: Thumbnail[];
  captions?: Caption[];
  formatStreams?: FormatStream[];
  hlsUrl?: string;
  dashUrl?: string;
  recommendedVideos?: VideoSummary[];
}

export interface ChannelDetails {
  author: string;
  authorId: string;
  authorThumbnails?: Thumbnail[];
  authorBanners?: Thumbnail[];
  subCount?: number;
  description?: string;
}

export interface PlaylistDetails {
  title: string;
  playlistId: string;
  author: string;
  authorId?: string;
  description?: string;
  videoCount: number;
  videos: (VideoSummary & { index?: number })[];
}

export interface CastItem {
  id: string;
  url: string;
  title: string;
  contentType: string;
  metadata: Record<string, unknown>;
  startPositionMs?: number;
  subtitleResources?: Array<{ url: string; language?: string; label?: string }>;
}

export interface LinkedSession {
  sessionId: string;
  addEventListener(type: 'needitems' | 'statechange' | 'ended', listener: (event: CustomEvent) => void): void;
  unlink(): Promise<void>;
  provideItems(requestId: string, result: { items: CastItem[]; endOfList: boolean }): Promise<void>;
}

export interface PlaybackDestination {
  id: string | null;
  name: string | null;
  kind: 'local' | 'native' | 'external';
  connected: boolean;
}

export interface PlaybridgeBridge {
  cast?(payload: CastItem | Record<string, unknown>): void;
  getPlaybackDestination?(): Promise<{ ok: true; destination: PlaybackDestination }>;
  choosePlaybackDestination?(options?: { destinationId: 'this-device' }): Promise<{ ok: true; destination: PlaybackDestination }>;
  play?(payload: Record<string, unknown>): Promise<LinkedSession>;
  capabilities?: { playback?: number; localPlaybackOrientation?: number };
}

declare global {
  interface Window {
    playbridge?: PlaybridgeBridge;
    __bridgedTest?: { playbridge?: PlaybridgeBridge; [key: string]: unknown };
  }
}
