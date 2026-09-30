# Bridged Streams

Svelte web client for Stremio-compatible catalog addons and browser-compatible Nuvio stream plugins. Connect Stremio and Nuvio accounts independently. Browse and play on the website; cast to PlayBridge when available.

## Run

From `bridged-apps/`:

```bash
pnpm install
pnpm dev:streams
```

Open `http://127.0.0.1:5182`. Install at least one Stremio-compatible addon with a catalog and metadata resource to browse titles. Add configured manifest URLs directly. Home shows featured titles, Continue Watching, Browse by Addon, and catalog rows. Search has a search bar and a Discover feed with Type, Catalog, and Genre dropdowns; compatible catalogs load more titles as you scroll. Catalogs that require an option use the addon's first listed option by default, such as the current year in Cinemeta's New rows. Nuvio plugin repositories add stream sources to those titles; they do not supply catalogs.

## Navigation and shared links

Cached addons and available catalogs open while account and manifest refreshes run in the background. The player keeps its source screen and unfinished provider requests alive, so starting a ready source or returning to its list does not repeat the lookups. Sources restored later are added to the open stream list.

Screens use URL routes with browser Back and Forward support. Hash routes work on the static Cloudflare deployment and the local server without rewrite configuration:

- `/#/search?q=Avengers`, `/#/library`, and `/#/settings`
- `/#/movie/tt1234567` for a movie's details
- `/#/series/tt1234567?season=2` for a selected season
- `/#/series/tt1234567/streams?video=tt1234567%3A2%3A3&season=2&episode=3` for episode streams
- `/#/catalog/ADDON_ID/movie/CATALOG_ID` for one catalog

Links resolve metadata and streams using the recipient's enabled addons. They do not install addons or contain account credentials or resolved stream URLs. Season and episode choices survive refreshes. Back returns from the player to streams, from streams to details (or the originating Continue Watching page), and from details to the originating catalog or tab. Scroll positions and loaded catalog pages are retained during navigation in the current page session. The player also has a route; reloading or sharing it opens stream selection so a fresh source can be chosen.

Home, Search, Library, and Settings switch immediately, without page or grid entrance animations. Each tab is retained after its first visit, preserving loaded cards and controls instead of rebuilding them on every switch. Inactive tabs do not paint or extend the current page's scroll area; supported browsers retain their layouts with CSS content visibility. The dock and detail/player flows keep their own animations. Touch layouts omit desktop hover overlays, and poster images decode asynchronously.

Refresh restores a recently opened title's name and artwork from a session cache (up to 24 titles for six hours), then loads fresh metadata. Uncached title links show a loading skeleton rather than a raw media ID. Playback actions remain disabled while details and account sources restore.

## Bridged Apps on Android

The site serves `/.well-known/playbridge-app.json`, which opts it into PlayBridge's Bridged Apps launcher. Open the deployed HTTPS site, or a local development server at a private LAN address such as `http://192.168.1.23:5182`, in PlayBridge's Android browser and choose **Add Bridged App** from the menu. Its tile then appears on the PlayBridge dashboard. Tapping the tile opens the site without browser chrome; Android Back returns to the dashboard after the site's own navigation history. Long press the tile to remove it. Installation and casting permission are separate.

Production builds register a service worker that caches only versioned app files (JavaScript, CSS, fonts, images, and WebAssembly) for faster repeat loads. The page document still comes from the network, so new deployments can load new asset hashes. Addon, account, stream, and media requests are excluded. Vite development builds do not register the worker.

Sports Streams and some other addons mark direct HTTP sources `notWebReady` even when the playlist and segments permit browser requests. These sources appear with **Try in browser** and **Cast** actions. Browser playback can still fail if the media host blocks it. Stream lookup errors now appear beside the source list.

## Stremio account sync

Open **Settings → Accounts and profiles → Stremio** and sign in with your Stremio email and password, or use an existing auth key for an account linked to another sign-in provider. Your password is sent directly to Stremio over HTTPS and is not stored. The auth key stays in this browser's site storage until you disconnect or clear site data.

The app imports your Stremio addons, library, and Continue Watching progress on sign-in and every 10 minutes. **Sync now** refreshes them immediately. Install an addon with **Stremio account** selected, remove an account addon, or change a Stremio library entry to write it back. Addons saved directly in Bridged Streams remain local. Nuvio plugin repositories and the TMDB key are separate from Stremio's addon collection.

Linked TV casts report movie and episode watch position to Stremio when PlayBridge sends playback state updates. On older PlayBridge versions without linked casting, movies use a direct cast without progress callbacks. Browser playback reports progress for both. Catalog and stream requests still depend on each addon's browser CORS support.

## Nuvio account sync

Open **Settings → Accounts and profiles → Nuvio** and sign in with your Nuvio Cloud email and password. The app uses [Nuvio's published public client key](https://github.com/NuvioMedia/self-host/blob/main/.env.example). For a self-hosted account, open **Self-hosted backend settings**, enter its backend URL, and load its public key from `/.well-known/nuvio` or enter the key printed by `./nuvio credentials`. Never enter a service-role or secret key. The password is not stored; the access and refresh tokens stay in this browser's site storage until you disconnect or clear site data.

Choose a Nuvio profile after signing in. If the account has no profiles, create a primary profile here or in Nuvio Mobile; if the profile request fails, use **Retry profiles** to see the error and try again. PIN-protected profiles must be unlocked in this tab before their data loads. The app imports addons, enabled plugin repositories, library titles, and watch progress on sign-in and every 10 minutes. Disabled addons remain visible in Manage addons. The Nuvio **Sync now** button refreshes them immediately. Imported sources are combined with local and Stremio sources for browsing. Browser CORS and scraper runtime limitations still apply.

Select **Nuvio profile** when installing an addon, or select **Install new plugin repositories in my Nuvio profile**, to save the source to that profile. Source removals and Nuvio library changes also sync back. Profiles configured to share the primary profile's sources must be edited from the primary profile. Browser playback and linked TV movie and episode casts report watch progress to both connected accounts; each account keeps its own library actions. Direct movie casts on older PlayBridge versions do not provide playback callbacks.

### Scraper controls and configuration sync

Under **Settings → Addons and playback**, individual scraper On/Off switches for a **Nuvio profile** repository now save to that profile. Scrapers declaring `hasSettings` have a **Configure** button that loads their `onSettings()` layout in an isolated worker. Text, masked password/token, select, toggle, and number fields are supported. Saved values are passed to the scraper as `SCRAPER_SETTINGS`; its ID is available as `SCRAPER_ID`. Configuration changes use a different stream-cache key, so the next lookup uses the new settings immediately.

These preferences sync between **Bridged Streams devices using the same Nuvio account/profile**, on restoration, every 10 minutes, or with **Sync Nuvio now**. Repositories marked **This browser** keep their switches and configuration local. Shared plugins use the primary profile's preferences and must be edited there. Failed saves leave the previous value intact and can be retried.

The inspected Nuvio Mobile version syncs repository URLs but stores individual scraper switches and settings only on the device. Bridged Streams cannot import those device-local values or change them in Nuvio Mobile. It uses Nuvio's existing `sync_pull_profile_settings_blob` / `sync_push_profile_settings_blob` APIs with its own `bridged-streams` platform namespace. Native mobile and TV settings are not overwritten. Each write reads the latest snapshot and merges only the scraper being changed; newer backends use the guarded RPC with conflict retries. Older backends fall back to the original RPC and simultaneous cross-device saves may use the last write. A backend missing the settings RPC reports a sync/save error rather than claiming success.

Plugin settings, including user-entered tokens, are stored in this browser's site data and in the selected Nuvio profile. The settings object is supplied to that scraper's worker. Any stream URLs or headers produced by the scraper follow the normal playback and casting flow.

## Addon controls

Open **Settings → Addons and playback** to change addon priority, turn an addon on or off, refresh its manifest, copy or open its URL, and remove it. Addons with a configuration page have a **Configure** link. The feature button lets you turn catalog, metadata, stream, and subtitle resources on or off separately. Catalog, metadata, and stream switches affect the website's requests; subtitle lookup is not yet part of browser playback.

Local addon order and switches stay in this browser. Stremio addon order syncs to Stremio, while its on/off and feature switches stay in this browser. Nuvio addon order and the main on/off switch sync to the selected Nuvio profile; per-resource switches stay in this browser. Disabled or unreachable addons remain listed so you can refresh, re-enable, or remove them. Cached addon manifests, catalog rows, and library data let the page show familiar content immediately after a refresh while account and addon requests update it in the background. Nuvio data from a PIN-protected profile stays hidden until that profile is unlocked. Stream URLs are resolved when you choose a title or episode. You can refresh catalogs manually, choose a 15, 30, or 60 minute auto refresh interval, or clear cached rows.

## TMDB enrichment

Open **Settings → Integrations → TMDB enrichment** and enable it with your own TMDB API key. It is off by default, uses the same browser-stored key as Nuvio scraper lookups, and does not require a TMDB account login in Bridged Streams. Choose a preferred language and independently enable artwork, basic information, title details, cast and crew, production companies, networks, episode details, season posters, trailers, recommendations, and movie collections.

Addon details appear first; TMDB enrichment loads in the background without delaying Play or stream selection. Public metadata is cached in this tab for six hours, with at most 60 cached API responses. Failed requests are not cached and can be retried. Episode details are fetched only for the season being viewed. Addon title IDs, episode IDs, release dates, existing IMDb ratings, and progress identity are preserved. TMDB fallback ratings are labeled TMDB. Trailers open in a responsive YouTube embed popup inside the app, with fullscreen controls and an optional YouTube link. Closing the popup or navigating away removes the player and stops playback. Recommended and collection titles use their IMDb identity for compatible addons when TMDB supplies one; playback still depends on installed stream providers, and series need an addon episode list.

Bridged Streams requires a user-entered key. Enrichment preferences are local to this browser and are not synced to Nuvio profiles.

## Casting

### Automatic stream selection

Open **Settings → Addons and playback → Auto-select stream**. It is off by default. Choose a resolution (Any, 4K, 1080p, or 720p), an addon or Nuvio scraper as the preferred provider, and one or more release types (Remux, BluRay, WEB-DL, WEBRip, HDTV, DVD, CAM/TS). No selected release types means Any. Settings stay in this browser.

With auto-selection enabled, Play, Resume, Continue Watching, and choosing an episode resolve streams and start a matching source in the browser. Use the detail page's Cast button for automatic casting; on an untracked series it first asks you to choose an episode. The stream page also offers **Play/Resume best match** and **Cast best match**. Resolution and release types are required matches, inferred from stream names and descriptions; unknown values cannot satisfy a specific filter. The preferred provider is tried first among matching streams, followed by other providers. A ready matching preferred provider starts without waiting for unrelated providers. Fallback selection waits for higher priority providers to finish. If nothing matches, the complete stream list remains available for manual selection.

**Choose another stream** returns from playback to that list. Refreshing, following a shared URL, or going Back does not trigger automatic playback. A manual stream selection takes priority for that playback session. Subsequent episodes first try its release group or matching provider/name and quality; if that release is unavailable, they use the saved preferences. Automatically selected episodes continue to respect the required filters. Casting remains lazy: the next episode resolves when the receiver requests it. Existing resume positions and progress reporting apply to both selection methods.

- Choose **Play** on a stream to watch in the website with MoviPlayer. It is loaded only when playback starts and supports MKV, MP4, HLS, DASH, and other formats supported by the player. Its FFmpeg WebAssembly engine is served as a separate, versioned `.wasm` asset. Deploy the entire `dist` directory so that asset is available. The source must allow browser requests, including media segments and required headers. A native video fallback is used if MoviPlayer cannot load.
- **Settings → Addons and playback → Native player fallback** controls whether the browser's video player is tried when MoviPlayer cannot play or load. It is on by default and saved in this browser.
- If playback fails, open **Playback diagnostics** below the error, run **Check player engine**, and copy the report. The same report is available under **Settings → Addons and playback** after closing the player or refreshing the page. It records recent import and playback events, asset timing, browser capabilities, and a direct WASM fetch and compile check. Stream URLs, request headers, and account credentials are excluded. Use **Clear history** to remove the saved entries.
- Browser playback reports movie and TV watch progress to connected accounts. TV playback looks for the next episode from the same source when the current episode ends.
- Movies use `window.playbridge.linkCast()` with one item when available so watch progress can sync. Older PlayBridge versions fall back to `cast()`.
- Series use `window.playbridge.linkCast()` with the chosen first episode. The client fetches further episode streams only after a `needitems` event, then supplies them through `provideItems()`.
- **Cast** is an additional action shown for each stream when the PlayBridge bridge is available. Linked casting needs a PlayBridge version with `capabilities.linkedCast`.
- Streams requiring a torrent engine, local debrid resolution, or proxy headers are shown as unavailable for direct casting.

## Browser plugin support

Nuvio plugin code runs in a Web Worker with browser APIs and a 30-second timeout. Like Nuvio, `require` supports `cheerio` (including `cheerio-without-node-native` and `react-native-cheerio`) and `crypto-js`. The `cheerio` and `CryptoJS` globals are also available. `global`, `window`, and `self` refer to the isolated worker runtime, without access to the app DOM or local storage. CommonJS exports and top-level/global `getStreams` functions are supported. Unsupported modules report their name instead of a generic `require is not defined` error.

Browser CORS rules still apply to the repository, scraper code, and sites a scraper fetches. Native-only Nuvio host functions (native fetch, DOM/WASM bridges, debrid services) and other Node modules are unavailable. Scrapers that declare only native platforms are skipped. Use plugin repositories you trust; their code runs locally after installation.

For IMDb-based catalog IDs, enter your own TMDB API key in Addons. The key stays in this browser's local storage and is sent to TMDB for ID lookup and to the selected scraper worker. Manifest URLs and plugin repository URLs also stay in local storage. Clear site data to remove them.

## Verify

```bash
pnpm --filter @bridged-apps/streams check
pnpm --filter @bridged-apps/streams build
pnpm test:e2e:streams
```
