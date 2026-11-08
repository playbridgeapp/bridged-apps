import type {
  ChannelDetails, PlaylistDetails, PlaylistSummary, SearchResult, VideoDetails, VideoSummary
} from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_MS = 20_000;

/** Invidious REST client. [base] is where requests go; [token] signs the /auth endpoints. */
export class InvidiousApi {
  readonly base: string;
  private token: string | null;

  constructor(base: string, token: string | null = null) {
    this.base = base;
    this.token = token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  get signedIn(): boolean {
    return !!this.token;
  }

  private async request(path: string, init: RequestInit = {}, auth = false): Promise<Response> {
    const headers = new Headers(init.headers);
    if (auth) {
      if (!this.token) throw new ApiError('Sign in to use this.', 401);
      headers.set('Authorization', `Bearer ${this.token}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    init.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${this.base}${path}`, { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new ApiError(auth ? 'Your sign-in has expired. Sign in again.' : 'The instance refused this request.', response.status);
        }
        if (response.status === 404) throw new ApiError('Not found on this instance.', 404);
        throw new ApiError(`The instance answered ${response.status}.`, response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (init.signal?.aborted) throw error;
      throw new ApiError(controller.signal.aborted ? 'The instance took too long to answer.' : "Couldn't reach the instance.");
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
    const response = await this.request(path, init, auth);
    const text = await response.text();
    // Invidious sometimes answers 200 with an empty body while YouTube is slow.
    if (!text.trim()) throw new ApiError('The instance sent an empty answer. Try again.');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError('The instance sent an answer this app can’t read.');
    }
  }

  trending(signal?: AbortSignal): Promise<VideoSummary[]> {
    return this.json('/api/v1/trending', { signal });
  }

  popular(signal?: AbortSignal): Promise<VideoSummary[]> {
    return this.json('/api/v1/popular', { signal });
  }

  search(query: string, page = 1, signal?: AbortSignal): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, page: String(page), type: 'all' });
    return this.json(`/api/v1/search?${params}`, { signal });
  }

  async video(id: string, signal?: AbortSignal): Promise<VideoDetails> {
    const path = `/api/v1/videos/${encodeURIComponent(id)}`;
    try {
      return await this.json<VideoDetails>(path, { signal });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status || signal?.aborted) throw error;
      return this.json<VideoDetails>(path, { signal });
    }
  }

  channel(id: string, signal?: AbortSignal): Promise<ChannelDetails> {
    return this.json(`/api/v1/channels/${encodeURIComponent(id)}`, { signal });
  }

  channelVideos(id: string, continuation?: string, signal?: AbortSignal): Promise<{ videos: VideoSummary[]; continuation?: string }> {
    const query = continuation ? `?continuation=${encodeURIComponent(continuation)}` : '';
    return this.json(`/api/v1/channels/${encodeURIComponent(id)}/videos${query}`, { signal });
  }

  playlist(id: string, page = 1, signal?: AbortSignal): Promise<PlaylistDetails> {
    return this.json(`/api/v1/playlists/${encodeURIComponent(id)}?page=${page}`, { signal });
  }

  /**
   * The same-origin path a manifest finally serves from. Instances with a
   * companion redirect manifests there; receivers get the final path so they
   * don't need to follow the redirect.
   */
  async resolveMediaPath(path: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request(path, { signal });
    void response.body?.cancel().catch(() => {});
    const final = new URL(response.url);
    const base = new URL(this.base);
    if (final.origin !== base.origin) return path;
    const basePath = base.pathname.replace(/\/+$/, '');
    const finalPath = basePath && final.pathname.startsWith(basePath) ? final.pathname.slice(basePath.length) : final.pathname;
    return `${finalPath}${final.search}`;
  }

  /** The channel id behind a channel name link (@handle, /c/, /user/). */
  async resolveChannel(url: string, signal?: AbortSignal): Promise<string> {
    const result = await this.json<{ ucid?: string; pageType?: string }>(`/api/v1/resolveurl?url=${encodeURIComponent(url)}`, { signal });
    if (!result.ucid) throw new ApiError('That link isn’t a channel this instance can find.', 404);
    return result.ucid;
  }

  feed(signal?: AbortSignal): Promise<{ notifications: VideoSummary[]; videos: VideoSummary[] }> {
    return this.json('/api/v1/auth/feed?max_results=60', { signal }, true);
  }

  subscriptions(signal?: AbortSignal): Promise<{ author: string; authorId: string }[]> {
    return this.json('/api/v1/auth/subscriptions', { signal }, true);
  }

  async subscribe(channelId: string, subscribed: boolean): Promise<void> {
    await this.request(`/api/v1/auth/subscriptions/${encodeURIComponent(channelId)}`, { method: subscribed ? 'POST' : 'DELETE' }, true);
  }

  history(page = 1, signal?: AbortSignal): Promise<string[]> {
    return this.json(`/api/v1/auth/history?max_results=40&page=${page}`, { signal }, true);
  }

  async markWatched(videoId: string): Promise<void> {
    await this.request(`/api/v1/auth/history/${encodeURIComponent(videoId)}`, { method: 'POST' }, true);
  }

  playlists(signal?: AbortSignal): Promise<PlaylistSummary[]> {
    return this.json('/api/v1/auth/playlists', { signal }, true);
  }

  async revoke(session: string): Promise<void> {
    await this.request('/api/v1/auth/tokens/unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session })
    }, true);
  }
}
