# Bridged Apps — Agent Guide

PlayBridge companion web apps. This repo is separate from PlayBridge core.

Portable skills live in `.agents/skills/` (Codex, OpenCode, Claude, Pi, and other Agent Skills clients).

| Skill | Use when |
|---|---|
| `bridged-apps-jellyfin` | Jellyfin Svelte app (`apps/jellyfin/`) or Playwright e2e (`e2e/`) |

Load `bridged-apps-jellyfin` before changing the Jellyfin client or tests.

## Layout

| Path | Notes |
|---|---|
| `apps/jellyfin/` | Svelte 5 + Vite client, port 5180 |
| `e2e/` | Playwright; Chromium default, Obscura optional |

## Commands

Always **pnpm**, from this repo root:

```bash
pnpm install
pnpm dev:jellyfin
pnpm test:e2e
```

Never overwrite `window.playbridge` (native Cast API). E2E hooks are `window.__bridgedTest`. Never commit Jellyfin tokens; use `e2e/.env.local`.
