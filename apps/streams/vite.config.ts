import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Plugin dependencies are first imported by a worker. Prebundle them up front
  // so the first scraper request does not trigger a dependency reload mid-run.
  optimizeDeps: { include: ['cheerio/slim', 'crypto-js'] },
  server: { host: '127.0.0.1', port: 5182 }
});
