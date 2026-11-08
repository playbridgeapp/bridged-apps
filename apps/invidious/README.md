# Bridged Invidious

A PlayBridge bridged app for a self-hosted [Invidious](https://invidious.io) instance.

- **Browse:** trending, search (videos, channels, playlists), channel and playlist pages. Long playlists load page by page as you scroll.
- **Pasted links:** the search box opens YouTube and Invidious links directly: videos (`watch?v=`, `youtu.be`, Shorts), playlists and channels (`@handle` links are resolved by the instance).
- **Playback:** with PlayBridge, videos play on the chosen destination. PlayBridge players (the phone and PlayBridge TVs) get the instance's DASH manifest; Google Cast, DLNA and Roku get the single-file 360p MP4. Captions are sent as subtitles. Casts skip the TV's pre-play screen. Without PlayBridge, the page plays the MP4 itself.
- **Autoplay:** off by default (Settings → Playback). When on, a related video follows each one and the TV's Up next stays filled. Playlists always continue to their end, loading further pages as the queue reaches them.
- **Account:** "Sign in with Invidious" uses the instance's `/authorize_token` page, so the app never sees the password. The token grants the subscription feed, subscriptions, watch history and playlists, and is revoked on sign-out.
- **Privacy:** every request, thumbnail, channel image and video goes through the instance (`local=true`, `/ggpht`); no device contacts YouTube or Google directly. Watch progress is kept in the browser.

## Hosting

Signed-in requests send an `Authorization` header, and Invidious refuses the browser's cross-origin preflight for them. Serve the built app from the **same origin as the instance** (for example a reverse proxy that serves the app beside Invidious), or browsing works but sign-in doesn't. Public HTTPS pages also can't call an `http://` instance (mixed content); PlayBridge allows bridged apps over plain HTTP on private IP addresses.

The instance address is entered on first launch and changed in Settings.

## Development

```bash
cp apps/invidious/.env.example apps/invidious/.env.local   # set INVIDIOUS_PROXY_TARGET
pnpm dev:invidious                                        # http://<this machine>:5184
pnpm --filter @bridged-apps/invidious check
pnpm --filter @bridged-apps/invidious build
pnpm exec node --test apps/invidious/test/*.test.mjs
```

With `INVIDIOUS_PROXY_TARGET` set, the dev server relays the instance's paths (`/api`, `/companion`, `/latest_version`, `/vi`, `/ggpht`, `/videoplayback`) from its own origin, the way a same-origin deployment would, so sign-in works in development. Media sent to receivers still uses the instance's own address, which they must be able to reach.

`.env.local` is git-ignored; keep instance addresses and tokens out of commits.
