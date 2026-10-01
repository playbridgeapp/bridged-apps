# Nuvio feature comparison

Compared Bridged Streams with the local `PlayBridge/inspirations/NuvioMobile` checkout at `d08fee79`. This is a source review of account integration, watching, and playback features; it does not claim identical behavior across every Nuvio release or native platform.

## Added in this change

Continue Watching now supports both **Resume** and **Next up** for Nuvio series. Completing S1E4 selects the next available episode, such as S1E5, at position zero. A newer unfinished episode takes precedence; older partial progress does not resurrect a finished show. Completion uses Nuvio's 90% threshold rather than Stremio's 95% threshold.

Streams imports profile-specific watched history through `sync_pull_watched_items`, including manually watched episodes without playback progress and legacy compact timestamps. History is paginated and cached under the account/profile scope, cleared on disconnect, and kept hidden until a PIN-protected profile is unlocked. A history request failure reports an error while playback progress remains usable.

Next up requires an addon episode list that contains the completed episode. Same-season episodes with no release date can qualify; a new season requires a known past release date. Future episodes and explicitly unavailable episodes are excluded. This is the available-episode behavior; Nuvio also offers an upcoming-episode preference described below.

Background metadata resolution remains limited to the 16 most recent eligible title candidates, with two lookups in flight and a 15-second timeout per lookup. It does not expand catalog pages. Finished candidates within that budget can yield fewer than 16 cards. Providers that omit episode lists or use incompatible numbering cannot supply Next up reliably.

Implementation: [watching selection](src/lib/nuvio-watching.ts), [resume selection](src/lib/resume.ts), [cloud integration](src/lib/nuvio.ts), and [browser regressions](../../e2e/streams/nuvio-continue-watching.spec.ts).

## Remaining gaps

| Priority | Feature | Nuvio reference | What Streams still needs |
|---|---|---|---|
| 1 | Watched/unwatched actions and history | `features/watched/WatchedRepository.kt`, `WatchedEpisodeActions.kt`; `features/watching/sync/SupabaseWatchedSyncAdapter.kt` | Episode badges and manual mark/unmark actions, bulk episode/season/show actions, and a history screen. Streams now reads watched markers but only writes playback progress; it does not write/delete watched-history markers. |
| 1 | Continue Watching controls | `features/watchprogress/ContinueWatchingPreferencesRepository.kt`; `features/home/HomeScreen.kt` | Dismiss/remove and reset controls, dismissed Next up identities, dropped-show filtering, row visibility/style/sort preferences, episode thumbnails, and spoiler blur. Native dismissals/preferences are not imported by this change. |
| 2 | Upcoming episodes and continuity preferences | `features/watching/domain/SeriesContinuity.kt`, `WatchingPolicies.kt` | Toggle furthest-completed versus most-recently-completed selection; show upcoming episodes with release information. Nuvio defaults to showing unaired Next up and limits a future season rollover to seven days. Streams currently selects the furthest completed episode and only available episodes. Native absolute-episode-number fallback for anime is also missing. |
| 2 | Faster sync and resilient writes | `features/watching/sync/SupabaseWatchedSyncAdapter.kt`; `features/watchprogress/WatchProgressRepository.kt` | Watched-history delta cursors and changes rather than full history every ten minutes; a persisted retry queue and conflict reconciliation for playback writes. Current cached reads and profile/generation guards are present, but failed progress writes have no durable offline outbox. |
| 2 | Addon subtitles | `features/player/SubtitleRepository.kt`, `SubtitleSelectionModel.kt` | Query enabled subtitle resources and connect returned tracks to browser playback and casting, with language/matching preferences. MoviPlayer's existing media tracks remain available; the missing feature is addon subtitle lookup. |
| 2 | Tracking services | `features/trakt/`, `features/simkl/`, `features/mdblist/` | Authentication, tracker-backed progress/library sources, watched-history mutations, scrobbling, and tracker list management. A Nuvio Cloud login alone does not provide these native integrations. |
| 3 | Full profile management | `features/profiles/ProfileRepository.kt`, `ProfileEditScreen.kt`, `AvatarPicker.kt` | Create additional profiles, rename/delete, choose avatars, and set/change/remove PINs. Streams already selects and unlocks profiles and can create an initial primary profile. |
| 3 | Native preference parity | `features/watchprogress/ContinueWatchingPreferencesRepository.kt`; native profile settings | Profile-aware watching/playback/home preferences shared with Nuvio. Streams' TMDB and auto-selection preferences are browser-local; scraper preferences use a separate `bridged-streams` settings namespace. Native device-local scraper settings cannot be imported from cloud source URLs. |
| 3 | Playback completion safeguards | `features/watching/domain/WatchingPolicies.kt` | Native handling of `ended` without a usable duration and short error/placeholder clips. Streams currently requires positive position/duration and uses the completion ratio; a short provider error clip can look completed. |
| Platform-dependent | Native sources and playback | `features/debrid/`, `features/downloads/`, native scraper/player implementations | Local debrid service/resolution, native-only scraper APIs, downloads/offline playback, and external-player handoff. Browser CORS, codec, and request-header constraints remain. Providers returning usable direct HTTP streams can already work. |

## Already present

Account/profile selection and PIN unlocking, addon/plugin repository import and management, library add/remove, partial progress import, browser and linked-cast progress reporting, lazy series casting, next-episode playback, stream auto-selection, TMDB enrichment, and browser-local source/cache controls are already implemented. These should not be counted as missing features.

## Recommended next work

Add watched/unwatched controls and Continue Watching dismissal first. They give users a way to correct imported state and hide unwanted Next up cards. Then add delta sync and durable progress-write retries, followed by addon subtitle lookup. Tracking services and native playback capabilities need separate integration work.

The comparison is based on checked-in code, not a live end-to-end test of every Nuvio integration. Browser tests use mocked cloud/provider responses; the account diagnostic uses read-only cloud data and Outlander metadata without modifying the account.
