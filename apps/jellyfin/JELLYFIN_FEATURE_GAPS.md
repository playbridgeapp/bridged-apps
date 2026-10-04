# Jellyfin Web comparison

This is a focused source comparison against the local checkout at
`PlayBridge/inspirations/jellyfin-web`, not a claim of compatibility with every
Jellyfin Web/server release. The companion app intentionally keeps its Svelte UI
and adds PlayBridge destinations rather than embedding the entire upstream UI.

## Addressed in this update

| Area | Reference behavior | Companion change |
|---|---|---|
| Play / Resume | `apps/modern/features/details/components/buttons/PlayOrResumeButton.tsx` passes saved ticks and selected media/audio/subtitle identity | Primary Play/Resume actions; confirmed browser seeks; bridge resume positions; version/audio/subtitle controls |
| Playback preparation | `components/playback/playbackmanager.js` requests `PlaybackInfo` using a device profile and track options | Negotiate sources; use returned direct/transcoding URLs; MIME types derived from the source; preserve reverse-proxy base paths |
| Watch progress | Playback manager reports start/progress/stop using current playback identity | Captured account/media/play-session reports for browser and linked/native sessions; refresh watching rows after stop |
| Search | `apps/legacy/features/search/api/useSearchItems.ts` queries the server | Server-backed, debounced live search and paginated results |
| Favorites | `apps/legacy/controllers/favorites.js` requests favorite items from the server | Server-backed favorites; failed writes do not claim success |
| Queue identity | Playback manager separates current item and playlist state | Start the selected episode at a valid native index; lazy source preparation; navigate linked sessions; preserve retryable demand |

Additional companion-specific corrections:

- Modern native destination APIs now match the Streams model, including explicit
  **This device** selection and stale/disconnected destination rejection. Local playback
  defaults to the browser player, with explicit PlayBridge player opt-in.
- Browser music buffers the negotiated next source and changes queue items without
  closing player chrome or discarding the buffered audio.
- Bridge absence no longer exposes Cast controls or enters fake casting state.
- Native Pause/Play is not simulated in the website; use the host’s Remote.
- Unlinking is labeled separately from stopping playback.
- Cache keys include server/user and complete query options rather than colliding
  across origins, filters, or pages. Async account/queue updates are fenced.
- Diagnostic payloads no longer expose tokens, authenticated URLs, or headers.
- A versioned Movi WASM asset is included in production output.

## Remaining upstream gaps / limits

These are not silently presented as implemented:

- Full upstream administration, user/preferences management, home customization,
  Live TV/DVR, SyncPlay, downloads, and server-management screens.
- Upstream’s grouped people/artists/studios search and dedicated navigation for
  all entity types. Companion search currently uses the server’s user Items API.
- Dedicated watched/unwatched actions, trailers, people/crew details, collections
  management, and the complete upstream filtering/sorting UI.
- Complete per-device codec probing, bitrate/quality controls, live-stream
  lifecycle, advanced subtitle styling/synchronization, and in-player track
  switching. Current track choices are made before playback.
- Persisted/offline-retry watch-report outboxes. Failed report requests are logged
  safely; periodic reporting can recover after temporary failures, but this does
  not guarantee offline progress survives closing the page.
- Reliable progress/remote control on legacy direct-only `cast()` hosts.
- Universal external-receiver queue/subtitle support. The host rejects unsupported
  combinations; the website cannot add native capabilities or bypass CORS.

Automated checks cover mocked Jellyfin/bridge contracts and real Chromium media
resume. Live Jellyfin transcoding, native Android/iOS decoding, and actual TV
receiver playback require separate manual/live verification.
