---
name: bridged-apps-jellyfin
description: Work on the PlayBridge Jellyfin companion web app and its Playwright e2e suite. Use for Svelte 5, Vite, casting via window.playbridge, audio player, server switch, or running/writing tests under e2e/. Always use pnpm.
---

# Bridged Apps — Jellyfin

## Establish ownership

- Repo root is this monorepo (`bridged-apps/`). The app lives in `apps/jellyfin/` (Svelte 5 + Vite on port **5180**).
- E2E lives in `e2e/`. Treat it as part of this project, not PlayBridge core.
- Load this skill before changing UI, player, auth, or tests.
- Do **not** assign `window.playbridge`. That name is the **native Cast bridge** (`cast`, `linkCast`, `capabilities`). Test hooks are `window.__bridgedTest` only (`apps/jellyfin/src/main.ts`).

## Work safely

1. Package manager is **pnpm** only (`pnpm install`, `pnpm dev:jellyfin`, `pnpm test:e2e`). Never npm or yarn.
2. Never commit Jellyfin tokens, passwords, or LAN IPs. Live credentials go in gitignored `e2e/.env.local` (see `e2e/.env.example`).
3. Do not log `serverConfig` / session JSON (it contains the access token).
4. `stopPlayback()` must run on server switch, logout, demo load, and new login so audio does not leak across accounts.
5. Prefer clicking real UI. Use `__bridgedTest.switchAccount` only to inject a live session in e2e.

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
pnpm test:e2e
```

If the change touches live playback or multi-server, run with `JELLYFIN_*` (and `JELLYFIN_B_*` for switch) in the environment or `e2e/.env.local`.
