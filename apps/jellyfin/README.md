# PlayBridge Jellyfin Web Client

A responsive Jellyfin client built with Svelte 5 and Vite. Browse and play in a normal browser, or use PlayBridge’s native fullscreen player and connected receivers when the bridge is available.

## Playback

- **Play / Resume** is the primary action on titles, cards, albums, and episodes.
- Without a bridge, video plays in the website using lazily loaded MoviPlayer, with an HTML video fallback. Music retains the mini-player, queue, shuffle, repeat, and lyrics UI.
- Updated Android/iOS hosts advertise `capabilities.playback`. **Plays on …** shows the authoritative native destination; selecting it opens PlayBridge’s existing device picker. **This device** defaults to the website’s browser player, including inside PlayBridge. Choose **PlayBridge player** from **Player** to explicitly use the native fullscreen player; a selected receiver still uses its native transport. Jellyfin does not silently substitute another destination when preparation fails or a receiver disconnects. Failed bridge starts offer explicit **Choose This device** and **Play in browser** recovery actions.
- Older hosts retain explicit **Cast** actions using `linkCast()` or `cast()`. Linked hosts support progress and lazy queues; direct-only hosts dispatch bounded playlists of up to 50 items and do not provide reliable receiver progress/control feedback.
- Saved Jellyfin positions apply to browser and bridge playback. Browser seeks are confirmed before progress is reported, so startup at zero cannot overwrite a saved resume point. Switching from native playback to **Play on This Screen** uses the latest receiver position and unlinks native playback; unlinking does **not** stop media already playing on the receiver.
- Native controls live in **PlayBridge Remote** (available from the host’s edge menu). The website displays session status and queue navigation, not simulated Pause/Play controls. Closing native session UI unlinks website authority while native media may continue.

### Stream preparation and tracks

Live items are prepared through Jellyfin’s `PlaybackInfo` endpoint. The client uses a player profile, the returned media source, and compatible direct-play/direct-stream or transcoding URLs instead of assuming every item is MP4. Server URL base paths are preserved.

Title details expose **Version**, **Audio**, and **Subtitles** when Jellyfin provides the relevant metadata. Explicit audio selection requests server stream preparation rather than pretending a static source can switch tracks. External WebVTT subtitles are rendered in browser playback and supplied to modern native sessions when returned by Jellyfin. Actual codec, transcoding, subtitle, and queue support still depends on the server and destination; external receivers have more limited capabilities.

Browser API/media/subtitle requests require server CORS support. Native bridge permissions and receiver network access still apply. Installing the website does not grant additional permissions.

### Queues and watch progress

Series playback chooses a resumable episode or the next unplayed regular episode. Selecting an episode starts there and keeps subsequent episodes in the queue. Modern/linked playback initially prepares only that item, with further sources prepared on `needitems`. Failed preparation remains retryable; partial supply does not incorrectly declare the series finished. **Retry queue** retries outstanding demand.

Browser music negotiates and buffers the next source in a standby audio element. Next, Previous, queue selection, and automatic advancement keep the mini/expanded player open; Next reuses the buffered source and its play-session identity. Failed next-source preparation leaves the current track and UI intact and can be retried.

Browser and linked/native playback report start, periodic progress, pause, and stop to the captured Jellyfin account, including media-source and play-session identity. Continue Watching and Next Up refresh after reporting stops. Logout, account switching, and new playback invalidate pending preparation, release linked authority, and prevent late responses from controlling a different account.

## Browsing

Home includes libraries, Continue Watching, Next Up, and recently added media. Movies, shows, folders, music, favorites, and title details retain the existing responsive UI.

Live **Search** and **Favorites** query the server, with paginated results, rather than filtering only the home/library subset. Favorite-save failures are surfaced without claiming success. Cache keys include server URL, user, and query options; API/media responses are not stored by the production service worker. Diagnostics redact account credentials, headers, and authenticated URLs.

A built-in demo library is available without an external server. See [Jellyfin reference comparison](JELLYFIN_FEATURE_GAPS.md) for the comparison scope and remaining upstream feature gaps; this is not a complete replacement for all Jellyfin Web administration/features.

## Development

From `bridged-apps/`:

```bash
pnpm install
pnpm dev:jellyfin
pnpm --filter @bridged-apps/jellyfin check
pnpm --filter @bridged-apps/jellyfin build
pnpm test:e2e
```

Open `http://localhost:5180`. Live e2e credentials belong in gitignored `e2e/.env.local`. The mocked playback suite runs without a live Jellyfin server or physical receivers:

```bash
pnpm exec playwright test -c e2e/playwright.config.ts e2e/jellyfin/playback.spec.ts
```

It covers browser/Movi resume using synthetic media, browser-first This device routing, explicit native player selection, in-place audio queue transitions and buffer reuse, native receiver routing, stale-target rejection, linked progress, queue retries/partial batches, cancellation, browser handoff, media versions/tracks, server search/favorites, and credential-safe diagnostics. Browser mocks do not verify native decoding or actual receiver playback.

## Add to PlayBridge

The site serves `/.well-known/playbridge-app.json`. Open the deployed HTTPS site, or a local development server at a private LAN address, in PlayBridge and choose **Add Bridged App**. Its dashboard tile opens the site without browser controls; bridge permissions remain separate. Jellyfin and Bridged Streams must use separate origins to appear as separate tiles.

Deploy the entire `dist` directory, including the separately emitted Movi WebAssembly asset. Production builds register a service worker that caches versioned app assets only; page documents, Jellyfin API responses, and authenticated media remain outside that cache.
