# Bridged Apps E2E

Playwright tests for the Jellyfin companion app. Chromium is the default browser. [Obscura](https://github.com/h4ckf0r0day/obscura) is an optional local CDP backend — the binary is **not** in this repo.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm exec playwright install chromium
```

## Run

```bash
pnpm test:e2e
```

This starts `pnpm dev:jellyfin` (`http://127.0.0.1:5180`) unless that server is already up.

- **Demo / design specs** always run. They click through the built-in Demo Library — no Jellyfin server required.
- **Live smoke specs** skip unless you set credentials (see below).

### Obscura

Requires `obscura` on `PATH` (or `OBSCURA_BIN`). Spawns `obscura serve --allow-private-network` if nothing is already listening.

```bash
pnpm test:e2e:obscura
```

To attach to a server you started yourself:

```bash
obscura serve --port 9222 --allow-private-network
OBSCURA_CDP=ws://127.0.0.1:9222 pnpm test:e2e
```

Obscura speaks CDP, so the helper uses Playwright `connectOverCDP`, not `connect`.

## Live Jellyfin

Copy `e2e/.env.example` to `e2e/.env.local` (gitignored; loaded automatically). Required:

| Variable | Purpose |
|---|---|
| `JELLYFIN_URL` | Server origin, no trailing slash |
| `JELLYFIN_TOKEN` | Access token |
| `JELLYFIN_USER_ID` | User GUID |

Optional: `JELLYFIN_USERNAME`, `JELLYFIN_SERVER_NAME`.

Do not commit tokens. Rotate any token that was previously hardcoded in scratch scripts.

Live specs drive the app through `window.__bridgedTest` (never `window.playbridge`, which is the native Cast bridge). Screenshot tests skip on CI until Linux baselines exist.

## Layout

| Path | Role |
|---|---|
| `playwright.config.ts` | Projects (desktop 1440×900, mobile 390×844), webServer |
| `fixtures.ts` | Chromium vs Obscura browser fixture |
| `helpers/cdp.ts` | CDP connect / spawn |
| `helpers/app.ts` | Demo + live session helpers |
| `jellyfin/demo-design.spec.ts` | Login, demo home, modal, nav, tokens |
| `jellyfin/demo-library.spec.ts` | Unreachable-URL error, Shows/seasons, demo Play, home screenshot |
| `jellyfin/live-smoke.spec.ts` | Env-gated connect + music library |
| `jellyfin/live-player.spec.ts` | Audio HUD, title ellipsis, queue z-index, lyrics, HUD screenshot |
| `jellyfin/live-login.spec.ts` | Server URL ping → credentials (password optional) |

Update visual baselines with `pnpm exec playwright test -c e2e/playwright.config.ts --update-snapshots`. Optional: `JELLYFIN_PASSWORD` to complete live form login.
