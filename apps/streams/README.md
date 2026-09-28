# Bridged Streams

Svelte web client for Stremio-compatible catalog addons and browser-compatible Nuvio stream plugins. Connect Stremio and Nuvio accounts independently. Browse and play on the website; cast to PlayBridge when available.

## Run

From `bridged-apps/`:

```bash
pnpm install
pnpm dev:streams
```

Open `http://127.0.0.1:5182`. Install at least one Stremio-compatible addon with a catalog and metadata resource to browse titles. Add configured manifest URLs directly. Home shows featured titles, Continue Watching, Browse by Addon, and catalog rows. Search has a search bar and a Discover feed with Type, Catalog, and Genre dropdowns; compatible catalogs load more titles as you scroll. Catalogs that require an option use the addon's first listed option by default, such as the current year in Cinemeta's New rows. Nuvio plugin repositories add stream sources to those titles; they do not supply catalogs.

Sports Streams and some other addons mark direct HTTP sources `notWebReady` even when the playlist and segments permit browser requests. These sources appear with **Try in browser** and **Cast** actions. Browser playback can still fail if the media host blocks it. Stream lookup errors now appear beside the source list.

## Stremio account sync

Open **Settings → Accounts and profiles → Stremio** and sign in with your Stremio email and password, or use an existing auth key for an account linked to another sign-in provider. Your password is sent directly to Stremio over HTTPS and is not stored. The auth key stays in this browser's site storage until you disconnect or clear site data.

The app imports your Stremio addons, library, and Continue Watching progress on sign-in and every 10 minutes. **Sync now** refreshes them immediately. Install an addon with **Stremio account** selected, remove an account addon, or change a Stremio library entry to write it back. Addons saved directly in Bridged Streams remain local. Nuvio plugin repositories and the TMDB key are separate from Stremio's addon collection.

Linked TV casts report movie and episode watch position to Stremio when PlayBridge sends playback state updates. On older PlayBridge versions without linked casting, movies use a direct cast without progress callbacks. Browser playback reports progress for both. Catalog and stream requests still depend on each addon's browser CORS support.

## Nuvio account sync

Open **Settings → Accounts and profiles → Nuvio** and sign in with your Nuvio Cloud email and password. The app uses [Nuvio's published public client key](https://github.com/NuvioMedia/self-host/blob/main/.env.example). For a self-hosted account, open **Self-hosted backend settings**, enter its backend URL, and load its public key from `/.well-known/nuvio` or enter the key printed by `./nuvio credentials`. Never enter a service-role or secret key. The password is not stored; the access and refresh tokens stay in this browser's site storage until you disconnect or clear site data.

Choose a Nuvio profile after signing in. If the account has no profiles, create a primary profile here or in Nuvio Mobile; if the profile request fails, use **Retry profiles** to see the error and try again. PIN-protected profiles must be unlocked in this tab before their data loads. The app imports addons, enabled plugin repositories, library titles, and watch progress on sign-in and every 10 minutes. Disabled addons remain visible in Manage addons. The Nuvio **Sync now** button refreshes them immediately. Imported sources are combined with local and Stremio sources for browsing. Browser CORS and scraper runtime limitations still apply.

Select **Nuvio profile** when installing an addon, or select **Install new plugin repositories in my Nuvio profile**, to save the source to that profile. Source removals and Nuvio library changes also sync back. Profiles configured to share the primary profile's sources must be edited from the primary profile. Browser playback and linked TV movie and episode casts report watch progress to both connected accounts; each account keeps its own library actions. Direct movie casts on older PlayBridge versions do not provide playback callbacks.

## Addon controls

Open **Settings → Addons and playback** to change addon priority, turn an addon on or off, refresh its manifest, copy or open its URL, and remove it. Addons with a configuration page have a **Configure** link. The feature button lets you turn catalog, metadata, stream, and subtitle resources on or off separately. Catalog, metadata, and stream switches affect the website's requests; subtitle lookup is not yet part of browser playback.

Local addon order and switches stay in this browser. Stremio addon order syncs to Stremio, while its on/off and feature switches stay in this browser. Nuvio addon order and the main on/off switch sync to the selected Nuvio profile; per-resource switches stay in this browser. Disabled or unreachable addons remain listed so you can refresh, re-enable, or remove them. Cached addon manifests, catalog rows, and library data let the page show familiar content immediately after a refresh while account and addon requests update it in the background. Nuvio data from a PIN-protected profile stays hidden until that profile is unlocked. Stream URLs are resolved when you choose a title or episode. You can refresh catalogs manually, choose a 15, 30, or 60 minute auto refresh interval, or clear cached rows.

## Casting

- Choose **Play** on a stream to watch in the website with MoviPlayer. It is loaded only when playback starts and supports MKV, MP4, HLS, DASH, and other formats supported by the player. The source must allow browser requests, including media segments and required headers. A native video fallback is used if MoviPlayer cannot load.
- Browser playback reports movie and TV watch progress to connected accounts. TV playback looks for the next episode from the same source when the current episode ends.
- Movies use `window.playbridge.linkCast()` with one item when available so watch progress can sync. Older PlayBridge versions fall back to `cast()`.
- Series use `window.playbridge.linkCast()` with the chosen first episode. The client fetches further episode streams only after a `needitems` event, then supplies them through `provideItems()`.
- **Cast** is an additional action shown for each stream when the PlayBridge bridge is available. Linked casting needs a PlayBridge version with `capabilities.linkedCast`.
- Streams requiring a torrent engine, local debrid resolution, or proxy headers are shown as unavailable for direct casting.

## Browser plugin support

Nuvio plugin code runs in a Web Worker with native browser APIs and a 30-second timeout. Browser CORS rules apply to the repository, scraper code, and sites a scraper fetches. Native-only Nuvio host functions (`require` polyfills, native fetch, DOM/WASM bridges, debrid services) are unavailable. Scrapers that declare only native platforms are skipped. Use plugin repositories you trust; their code runs locally after installation.

For IMDb-based catalog IDs, enter your own TMDB API key in Addons. The key stays in this browser's local storage and is sent to TMDB for ID lookup and to the selected scraper worker. Manifest URLs and plugin repository URLs also stay in local storage. Clear site data to remove them.

## Verify

```bash
pnpm --filter @bridged-apps/streams check
pnpm --filter @bridged-apps/streams build
pnpm test:e2e:streams
```
