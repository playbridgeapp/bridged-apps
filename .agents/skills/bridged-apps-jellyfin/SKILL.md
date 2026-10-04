---
name: bridged-apps-jellyfin
description: Work on the Jellyfin companion client under apps/jellyfin/ and its Playwright suite under e2e/jellyfin/. Use for Jellyfin auth, server switching, browser playback, queues, casting and client UI; Streams work uses bridged-apps-streams. Always use pnpm.
---

# Bridged Apps — Jellyfin

## Establish ownership

- Repo root is this monorepo (`bridged-apps/`). The app lives in `apps/jellyfin/` (Svelte 5 + Vite on port **5180**).
- Jellyfin E2E lives in `e2e/jellyfin/`, using `e2e/playwright.config.ts`. Streams has a separate config and suite; shared `e2e/helpers/` changes must consider their callers.
- Load this skill before changing UI, player, auth, or tests.
- Do **not** assign `window.playbridge`. That name is the **native playback/Cast/plugin bridge**; feature-detect its methods and `capabilities`. Jellyfin’s adapter still uses `cast()` / `linkCast()`. Test hooks are `window.__bridgedTest` only (`apps/jellyfin/src/main.ts`).

## Work safely

1. Package manager is **pnpm** only (`pnpm install`, `pnpm dev:jellyfin`, `pnpm test:e2e`). Never npm or yarn.
2. Never commit Jellyfin tokens, passwords, or LAN IPs. Live credentials go in gitignored `e2e/.env.local` (see `e2e/.env.example`).
3. Do not log `serverConfig` / session JSON (it contains the access token).
4. `stopPlayback()` must run on server switch, logout, demo load, and new login so audio does not leak across accounts.
5. Prefer clicking real UI. Use `__bridgedTest.switchAccount` only to inject a live session in e2e.
6. The production bridge adapter is `apps/jellyfin/src/lib/cast/playbridge.ts`. It currently uses `cast()` / `linkCast()`; do not assume Jellyfin already uses Streams' unified `play()` destination flow. Coordinate native API changes with the PlayBridge repo.
7. Production service workers cache versioned app assets only; keep account, API and authenticated media requests out of the cache.
8. Native hosts own installed-app name/Home URL editing and removal. The manifest’s `start_url` supplies the initial home; users may edit it within the installed origin. Fresh host launches start at the saved home, not the last deep link, while live Dashboard/Remote switches retain the page. Keep cold-entry routes and account restoration working; removal does not erase website storage or casting grants. These native settings do not add website installation-management APIs. See the PlayBridge repo’s `docs/bridged-apps.md`.

## Commands (from repo root)

```bash
pnpm install
pnpm dev:jellyfin          # http://127.0.0.1:5180
pnpm --filter @bridged-apps/jellyfin check
pnpm exec playwright install chromium   # once per machine
pnpm test:e2e              # Chromium; demo specs always run
pnpm test:e2e:obscura      # optional Obscura CDP if `obscura` is on PATH
```

Playwright config: `e2e/playwright.config.ts`. Details: `e2e/README.md`.

## E2E rules

| Suite | When it runs | Needs |
|---|---|---|
| `e2e/jellyfin/demo-*.spec.ts` | Always | Dev server (webServer starts it) |
| `e2e/jellyfin/live-*.spec.ts` | Skip unless env set | `JELLYFIN_URL`, `JELLYFIN_TOKEN`, `JELLYFIN_USER_ID` |
| Switch-server spec | Skip unless B set | `JELLYFIN_B_URL`, `JELLYFIN_B_TOKEN`, `JELLYFIN_B_USER_ID` |
| Screenshots | Skip on `CI` | Darwin baselines in `*-snapshots/` |

- Default browser is Playwright Chromium, not Obscura.
- Assert playback with `audio.paused === false` (`expectAudioPlaying`), not only that the mini-player is visible.
- After Play on a cold load, `<audio>` nodes must already be mounted (`VideoPlayer.svelte`).
- Mobile expand: chevron in `.mini-left` (artwork/title). `.mini-expand-btn` is hidden under 768px; bar center is pause.
- Do not add Obscura binaries or screenshot dumps of personal libraries to git.

## Verify

From repo root, after UI or player changes:

```bash
pnpm --filter @bridged-apps/jellyfin check
pnpm --filter @bridged-apps/jellyfin build
pnpm test:e2e
```

If the change touches live playback or multi-server, run with `JELLYFIN_*` (and `JELLYFIN_B_*` for switch) in the environment or `e2e/.env.local`.
