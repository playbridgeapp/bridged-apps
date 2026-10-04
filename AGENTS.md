# Bridged Apps — Agent Guide

PlayBridge companion web apps. This repo is separate from PlayBridge core.

Portable skills live in `.agents/skills/` (Codex, OpenCode, Claude, Pi, and other Agent Skills clients).

| Skill | Use when |
|---|---|
| `bridged-apps-jellyfin` | Jellyfin Svelte app (`apps/jellyfin/`) or its Playwright e2e (`e2e/jellyfin/`) |
| `bridged-apps-streams` | Streams Svelte app (`apps/streams/`), account/watching sync, addons/plugins, playback destinations, or its unit/e2e tests |

Load `bridged-apps-jellyfin` before changing the Jellyfin client or tests.
Load `bridged-apps-streams` before changing Streams or its tests. Shared e2e
configuration changes must consider both suites; the default e2e command runs
only Jellyfin.

## Layout

| Path | Notes |
|---|---|
| `apps/jellyfin/` | Svelte 5 + Vite client, port 5180 |
| `apps/streams/` | Svelte 5 + Vite client, port 5182; independent Stremio/Nuvio integrations |
| `e2e/jellyfin/` | Playwright; Chromium default, Obscura optional |
| `e2e/streams/` | Playwright Chromium with mocked account/provider/bridge responses |

## Commands

Always **pnpm**, from this repo root:

```bash
pnpm install
pnpm dev:jellyfin
pnpm dev:streams
pnpm --filter @bridged-apps/jellyfin check
pnpm --filter @bridged-apps/streams check
pnpm test:e2e                  # Jellyfin only
pnpm test:e2e:streams          # Streams only
```

Streams unit tests import TypeScript directly. Use Node with unflagged type
stripping (22.18+ or a compatible newer release):

```bash
pnpm exec node --test apps/streams/test/*.test.mjs
```

Never overwrite `window.playbridge` (native playback/Cast/plugin API). E2E hooks
are `window.__bridgedTest`; both clients accept a mock bridge at
`window.__bridgedTest.playbridge`. Keep account credentials, configured private
addon URLs and signed streams out of committed fixtures and logs. Live Jellyfin
test credentials belong in gitignored `e2e/.env.local`.

PlayBridge native hosts are maintained in the separate PlayBridge repo. A
website change cannot grant native permissions, remove browser CORS restrictions
or add an unavailable native capability. Coordinate page API changes with the
host's `docs/bridged-apps.md` and Android/Apple/extension skills.
