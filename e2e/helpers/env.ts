import fs from 'node:fs';
import path from 'node:path';

function applyEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Load gitignored local env without adding a dotenv dependency. */
export function loadLocalEnv(): void {
  applyEnvFile(path.resolve(process.cwd(), '.env.local'));
  applyEnvFile(path.resolve(process.cwd(), 'e2e/.env.local'));
}
