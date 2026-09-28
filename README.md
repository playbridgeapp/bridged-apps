# Bridged Apps

PlayBridge-enabled companion web apps and media clients.

This monorepo contains modern, fast, zero-telemetry web applications tailored for specific media servers and streaming platforms, pre-wired with native **[PlayBridge](https://github.com/playbridgeapp/playbridge)** direct casting, playlist queueing, and remote control support.

---

## Applications

| Application | Path | Framework | Description |
| :--- | :--- | :--- | :--- |
| **Jellyfin Web Client** | `apps/jellyfin` | Svelte 5 + Vite | Multi-server/multi-user Jellyfin client with direct & linked PlayBridge casting, hierarchical library navigation, and offline SWR caching. |
| **Bridged Streams** | `apps/streams` | Svelte 5 + Vite | Cinematic web browsing, MoviPlayer playback, Stremio and Nuvio account sync, browser-compatible Nuvio plugins, and optional PlayBridge casting. |

---

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+

### Install Dependencies
```bash
pnpm install
```

### Run Jellyfin Web App
```bash
pnpm dev:jellyfin
```
The client will start locally at `http://localhost:5180` (or `5181`).

### Build All Apps
```bash
pnpm build
```

### End-to-end tests
```bash
pnpm exec playwright install chromium
pnpm test:e2e                 # Chromium + demo library
pnpm test:e2e:obscura         # optional Obscura CDP backend
```
Demo/design specs always run. Live Jellyfin smoke tests skip unless `JELLYFIN_URL`, `JELLYFIN_TOKEN`, and `JELLYFIN_USER_ID` are set. See [`e2e/README.md`](e2e/README.md).

Agent harnesses: load skill `bridged-apps-jellyfin` (`.agents/skills/bridged-apps-jellyfin/SKILL.md`, listed in `AGENTS.md`).

---

## PlayBridge Integration

All apps in this repository integrate seamlessly with the PlayBridge casting suite:
- **Direct Cast**: Transmits media streams and metadata directly to PlayBridge TV / Desktop receivers via `window.playbridge`.
- **Linked Queue Cast**: Pre-queues television seasons and playlist items for instant next-track transitions.
- **Local Network Only**: No cloud accounts, external proxies, or tracking telemetry required.

---

## License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
