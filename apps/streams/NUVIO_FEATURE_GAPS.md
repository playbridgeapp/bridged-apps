# Nuvio feature comparison

Compared Bridged Streams with the local `PlayBridge/inspirations/NuvioMobile` checkout at `d08fee79`. This is a source review of account integration, watching, and playback features; it does not claim identical behavior across every Nuvio release or native platform.

## Added in this change

Continue Watching now supports both **Resume** and **Next up** for Nuvio series. Completing S1E4 selects the next available episode, such as S1E5, at position zero. A newer unfinished episode takes precedence; older partial progress does not resurrect a finished show. Completion uses Nuvio's 90% threshold rather than Stremio's 95% threshold.

Streams imports profile-specific watched history through `sync_pull_watched_items`, including manually watched episodes without playback progress and legacy compact timestamps. History is paginated and cached under the account/profile scope, cleared on disconnect, and kept hidden until a PIN-protected profile is unlocked. A history request failure reports an error while playback progress remains usable.

Next up requires an addon episode list that contains the completed episode. Same-season episodes with no release date can qualify; a new season requires a known past release date. Future episodes and explicitly unavailable episodes are excluded. This is the available-episode behavior; Nuvio also offers an upcoming-episode preference described below.

Background metadata resolution remains limited to the 16 most recent eligible title candidates, with two lookups in flight and a 15-second timeout per lookup. It does not expand catalog pages. Finished candidates within that budget can yield fewer than 16 cards. Providers that omit episode lists or use incompatible numbering cannot supply Next up reliably.

Implementation: [watching selection](src/lib/nuvio-watching.ts), [resume selection](src/lib/resume.ts), [cloud integration](src/lib/nuvio.ts), and [browser regressions](../../e2e/streams/nuvio-continue-watching.spec.ts).

The webapp now also provides movie/episode watched and unwatched actions, season actions, watched badges, Continue Watching dismissal and progress reset, durable playback-write retries for Nuvio and Stremio, Nuvio progress/history delta sync, and addon VTT/SRT subtitles in the browser player. Unwatched removes both the watched marker and matching progress; reset preserves watched history. Dismissal lasts until newer activity and uses Streams' own cloud settings namespace, leaving native Continue Watching preferences separate.

Delta snapshots capture the cursor before the initial full pull and replay intervening events, then atomically persist records and cursor. Polls run every 30 seconds while visible; older backends keep the full-sync path. Playback writes persist every five seconds or on final events, coalesce by item, retry after reload, and defer to newer cloud progress. The browser must reopen to retry after being closed. Short placeholder clips cannot update watching state; completion without a usable duration remains unsupported.

## Remaining gaps

| Priority | Feature | Nuvio reference | What Streams still needs |
|---|---|---|---|
| 1 | Watched/unwatched actions and history | `features/watched/WatchedRepository.kt`, `WatchedEpisodeActions.kt`; `features/watching/sync/SupabaseWatchedSyncAdapter.kt` | Whole-show actions and a history screen. Episode/movie mark/unmark, season actions, and badges are implemented against the existing watched-history APIs. |
| 1 | Continue Watching controls | `features/watchprogress/ContinueWatchingPreferencesRepository.kt`; `features/home/HomeScreen.kt` | Native dismissal/preference import, dropped-show filtering, row visibility/style/sort preferences, episode thumbnails, and spoiler blur. Streams implements hide-until-new-activity and title progress reset. |
| 2 | Upcoming episodes and continuity preferences | `features/watching/domain/SeriesContinuity.kt`, `WatchingPolicies.kt` | Toggle furthest-completed versus most-recently-completed selection; show upcoming episodes with release information. Nuvio defaults to showing unaired Next up and limits a future season rollover to seven days. Streams currently selects the furthest completed episode and only available episodes. Native absolute-episode-number fallback for anime is also missing. |
| 2 | Faster sync and resilient writes | `features/watching/sync/SupabaseWatchedSyncAdapter.kt`; `features/watchprogress/WatchProgressRepository.kt` | Delta cursors and durable retries are implemented. Atomic cross-device compare-and-set progress mutations require backend support; the client checks imported timestamps before replaying queued changes. Browser background execution is limited when the page is closed. |
| 2 | Addon subtitles | `features/player/SubtitleRepository.kt`, `SubtitleSelectionModel.kt` | External subtitle casting and automatic language/matching preferences. Enabled addon lookup and manually selected VTT/SRT tracks are implemented in browser playback. |
| 2 | Tracking services | `features/trakt/`, `features/simkl/`, `features/mdblist/` | Authentication, tracker-backed progress/library sources, watched-history mutations, scrobbling, and tracker list management. A Nuvio Cloud login alone does not provide these native integrations. |
| 3 | Full profile management | `features/profiles/ProfileRepository.kt`, `ProfileEditScreen.kt`, `AvatarPicker.kt` | Create additional profiles, rename/delete, choose avatars, and set/change/remove PINs. Streams already selects and unlocks profiles and can create an initial primary profile. |
| 3 | Native preference parity | `features/watchprogress/ContinueWatchingPreferencesRepository.kt`; native profile settings | Profile-aware watching/playback/home preferences shared with Nuvio. Streams' TMDB and auto-selection preferences are browser-local; scraper preferences use a separate `bridged-streams` settings namespace. Native device-local scraper settings cannot be imported from cloud source URLs. |
| 3 | Playback completion safeguards | `features/watching/domain/WatchingPolicies.kt` | Native handling of `ended` without a usable duration. Streams normalizes ended events with a known duration and excludes short provider clips. |
| Platform-dependent | Native sources and playback | `features/debrid/`, `features/downloads/`, native scraper/player implementations | Local debrid service/resolution, native-only scraper APIs, downloads/offline playback, and external-player handoff. Browser CORS, codec, and request-header constraints remain. Providers returning usable direct HTTP streams can already work. |

## Already present

Account/profile selection and PIN unlocking, addon/plugin repository import and management, library add/remove, partial progress import, browser and linked-cast progress reporting, lazy series casting, next-episode playback, stream auto-selection, TMDB enrichment, and browser-local source/cache controls are already implemented. These should not be counted as missing features.

## Recommended next work

The requested watching controls, delta sync, durable save retries, and browser addon subtitles are implemented. Further work can add a history screen, native watching preferences, subtitle casting, and language selection preferences. Tracking services and native playback capabilities need separate integration work.

The comparison is based on checked-in code, not a live end-to-end test of every Nuvio integration. Browser tests use mocked cloud/provider responses; the account diagnostic uses read-only cloud data and Outlander metadata without modifying the account.
