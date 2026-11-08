import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Paths an Invidious instance serves. In development they can be relayed from
// the app's own origin so signed-in requests avoid a cross-origin preflight,
// the same way a deployment beside the instance would serve them.
const INSTANCE_PATHS = ['/api', '/companion', '/latest_version', '/vi', '/ggpht', '/videoplayback'];

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').INVIDIOUS_PROXY_TARGET?.replace(/\/+$/, '') || '';
  return {
    plugins: [svelte()],
    define: { __INVIDIOUS_PROXY_TARGET__: JSON.stringify(target) },
    server: {
      host: '0.0.0.0',
      port: 5184,
      proxy: target
        ? Object.fromEntries(INSTANCE_PATHS.map((path) => [path, { target, changeOrigin: true }]))
        : undefined
    }
  };
});
