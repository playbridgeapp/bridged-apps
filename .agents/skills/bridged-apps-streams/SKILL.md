---
name: bridged-apps-streams
description: Work on Bridged Streams under apps/streams/ and its unit/Playwright tests. Use for Stremio/Nuvio accounts, Continue Watching, addon and plugin resolution, native playback destinations, Movi/subtitles, stream matching, or tab/catalog performance. Native host implementations live in the separate PlayBridge repo.
---

# Bridged Streams

## Ownership and navigation

- Work from the `bridged-apps/` root with pnpm. The Svelte 5/Vite app is `apps/streams/`, port 5182; `src/App.svelte` orchestrates routes, account state and playback. Prefer the existing `src/lib/` modules for domain behavior.
- Read `apps/streams/README.md` for current behavior. `NUVIO_FEATURE_GAPS.md` is a comparison against a specific native checkout, not an authoritative list for every Nuvio release; confirm claims against current code before adding parity features.
- Hash routes are the static-hosting contract. Shared links contain title/episode identity, never credentials or resolved stream URLs. Refreshing a player route resolves fresh stream selection.
- Inactive Home/Search/Library/Settings tabs unmount and tab switches reset scroll to the top. Returning from details/streams/catalogs restores the originating screen's scroll and loaded pages. Preserve cached search drafts/results while avoiding retained poster DOM for inactive tabs.
- `HomeContent.svelte` defers content mounting until the tab shell can paint; `CatalogRail.svelte` controls row rendering. Preserve staged rendering and cache ownership when addressing performance. Do not restore every previously loaded catalog item to the DOM during a tab switch.

## Playback destinations

- Never assign `window.playbridge`. Use `src/lib/cast.ts` and the capability-gated host API. Tests can supply `window.__bridgedTest.playbridge` without replacing the injected object.
- A modern host advertises `capabilities.playback` and exposes `getPlaybackDestination()`, `choosePlaybackDestination()` and `play()`. Use the existing native destination picker. Play/Resume goes to the selected destination; **This device** uses the host's fullscreen player, and no bridge uses `movi-player`.
- Display the destination on details/stream selection. Preserve explicit local selection and reject stale destinations after async preparation; do not silently play on a different device. Keep legacy `cast()` / `linkCast()` capability fallbacks separate from the modern destination contract.
- Local and native PlayBridge sessions support lazy episode supply and progress; external receivers have more limited queue/subtitle support. Fence late lookups with the existing playback generation and consume final progress before teardown. Unlink ends website authority while media may continue on the host.
- Browser playback must account for Movi's canvas/WASM path; absence of an HTML video element does not prove that playback stopped. Preserve SRT/WebVTT addon subtitle fetching/conversion and revoke temporary resources when replacing the player.
- Stream sorting and automatic selection are separate preferences in `stream-selection.ts`. Ranking matches must retain nonmatching results; auto-selection keeps a manual stream-list path when no match exists.

## Account and watching state

- Stremio and Nuvio accounts are independent. Preserve account/profile scope in caches, pending writes and async responses. PIN-protected Nuvio data stays hidden until unlocked; inherited sources are edited from the primary profile.
- `nuvio-watching.ts`, `resume.ts` and `watching-controls.ts` own Resume/Next up and watching mutations. Preserve Nuvio's 90% versus Stremio's 95% completion thresholds, newer partial-episode precedence, available-episode checks and metadata-based next-episode identity.
- Unwatched clears matching progress and watched markers. Reset clears progress and preserves watched history. Dismissal hides until newer activity; Streams stores Nuvio preferences in its own `bridged-streams` namespace, leaving native preferences intact.
- `playback-outbox.ts` persists writes before network submission and coalesces by scope/item. Acknowledge the exact revision so an older in-flight save cannot erase a newer one. Preserve terminal saves, reconnect/reload retries and account-disconnect cleanup. Do not advance progress from short provider error clips.
- `delta-sync.ts` persists records and cursor atomically, captures the initial cursor before a full pull and falls back for unsupported/expired cursors. Delta reads consume cloud updates; they do not control how frequently a TV uploads progress.
- Do not log or commit account sessions, private addon configurations, plugin secrets, TMDB keys or authenticated stream URLs. Use mocked cloud fixtures for routine tests.

## Addons and plugins

- Catalog/metadata addons and Nuvio stream plugins serve different roles. Keep addon/resource toggles, order, provider settings and cache keys consistent; a plugin repository supplies streams, not catalogs.
- Browser scrapers run in isolated workers (`plugins.ts`, `scraper-runtime.ts`, `scraper-worker.ts`). Preserve timeouts and cancellation, worker module shims and safe error reporting. Browser CORS remains in effect; `no-cors` does not produce readable scraper responses.
- `native-plugins.ts` uses the device resolver only when advertised. Android FOSS supports an opt-in resolver shared with Library; Play builds and iOS do not. Device providers require installed code/domain approval. Send installed identifiers and media identity, never code, arbitrary fetch requests, settings or account secrets.
- An unavailable/disabled/unapproved/failing native provider must not fall back to executing its web scraper. Preserve document/route cancellation, bounded concurrency, provider deduplication and header normalization in `plugin-headers.ts`. Resolving a URL does not guarantee browser playback compatibility.
- Native installation/approvals and web/cloud plugin settings are distinct. Changes to the bridge must be checked against the PlayBridge host's `docs/bridged-apps.md` and affected Android/extension/Apple skills.
- The production service worker caches versioned app assets, not account/provider/stream responses. Keep this distinction when changing startup/cache behavior.

## Verification

From the repository root:

```bash
pnpm --filter @bridged-apps/streams check
pnpm --filter @bridged-apps/streams build
pnpm exec node --test apps/streams/test/*.test.mjs
pnpm test:e2e:streams
```

Unit tests import TypeScript directly. Use Node with unflagged type stripping
([Node 22.18 release notes](https://nodejs.org/en/blog/release/v22.18.0)). Choose
relevant unit files and Playwright specs while iterating.
`e2e/streams.config.ts` starts the dev server and uses Chromium; install it with
`pnpm exec playwright install chromium` when missing. `pnpm test:e2e` runs
Jellyfin, so it does not verify Streams.

Use `e2e/streams/` mocks for cloud/provider/bridge behavior. Browser mocks do not
validate native decoding, actual receiver playback or live service availability;
state any manual host/device checks separately.
