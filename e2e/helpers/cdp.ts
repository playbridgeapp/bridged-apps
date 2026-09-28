import { chromium, type Browser } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';

const DEFAULT_PORT = 9222;
const START_TIMEOUT_MS = 15_000;

export function shouldUseObscura(): boolean {
  return Boolean(process.env.USE_OBSCURA || process.env.OBSCURA_CDP);
}

export function obscuraPort(): number {
  const raw = process.env.OBSCURA_PORT;
  const parsed = raw ? Number(raw) : DEFAULT_PORT;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function obscuraBin(): string {
  return process.env.OBSCURA_BIN || 'obscura';
}

export function isCdpRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForCdp(port: number, child: ChildProcess | null): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < START_TIMEOUT_MS) {
    if (await isCdpRunning(port)) return;
    if (child?.exitCode != null) {
      throw new Error(`obscura exited with code ${child.exitCode} before CDP was ready`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Obscura CDP did not become ready on port ${port} within ${START_TIMEOUT_MS}ms`);
}

/**
 * Launch Chromium, or connect over CDP to Obscura.
 *
 * Obscura speaks Chrome DevTools Protocol, not Playwright's own wire protocol,
 * so this must use `connectOverCDP` (not `connect` / `connectOptions`).
 *
 * Env:
 *   USE_OBSCURA=1          spawn `obscura serve` if nothing is listening
 *   OBSCURA_CDP=ws://...   connect to an already-running server
 *   OBSCURA_PORT=9222      port when spawning / probing
 *   OBSCURA_BIN=obscura    binary on PATH, or an absolute path
 */
export async function connectBrowser(): Promise<{
  browser: Browser;
  cleanup: () => Promise<void>;
}> {
  if (!shouldUseObscura()) {
    const browser = await chromium.launch();
    return {
      browser,
      cleanup: async () => {
        await browser.close();
      }
    };
  }

  const port = obscuraPort();
  const endpoint = process.env.OBSCURA_CDP || `ws://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;

  if (!process.env.OBSCURA_CDP && !(await isCdpRunning(port))) {
    child = spawn(obscuraBin(), ['serve', '--port', String(port), '--allow-private-network'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      await waitForCdp(port, child);
    } catch (err) {
      child.kill();
      throw err;
    }
  }

  const browser = await chromium.connectOverCDP(endpoint);
  return {
    browser,
    cleanup: async () => {
      await browser.close().catch(() => undefined);
      if (child) {
        child.kill();
      }
    }
  };
}
