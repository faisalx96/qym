import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { docsContentPlugin } from './plugins/docs-content';

// The platform serves this app at its root (QYM_ROOT_PATH, e.g. /qym, when
// mounted). The served index.html gets `<base href="{root}/">`, so every asset
// URL is relative and resolves against it. React Router gets its basename at
// runtime from the injected window.__QYM_APP__.rootPath (see src/lib/runtime.ts).
const PLATFORM_PORT = process.env.QYM_PLATFORM_PORT ?? '8800';
const VITE_PORT = Number(process.env.QYM_VITE_PORT ?? '5800');
const platform = `http://127.0.0.1:${PLATFORM_PORT}`;

/** In `vite dev` nothing serves the page, so mirror what qym_platform/api/spa.py injects in production. */
function devBootstrap(): Plugin {
  return {
    name: 'qym-dev-bootstrap',
    apply: 'serve',
    transformIndexHtml(html) {
      const boot = {
        rootPath: '',
        authMode: process.env.QYM_AUTH_MODE ?? 'none',
        sessionAuth: process.env.QYM_AUTH_MODE === 'oidc' || process.env.QYM_AUTH_LOCAL_ENABLED === 'true',
        environment: 'development',
      };
      return html.replace(
        '<!--__QYM_APP_BOOTSTRAP__-->',
        `<base href="/"><script>window.__QYM_APP__ = ${JSON.stringify(boot)};</script>`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devBootstrap(), docsContentPlugin()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  build: {
    outDir: '../packages/platform/qym_platform/_static/app',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Merge chunks under 20 kB into a neighbour: on a high-latency link every request is a round trip (perf round 6).
        experimentalMinChunkSize: 20_000,
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          aria: ['react-aria-components'],
          'docs-runtime': ['hast-util-to-jsx-runtime'],
        },
      },
    },
  },
  server: {
    port: VITE_PORT,
    strictPort: true,
    // Same-origin for the browser: cookies, the write guard and the login
    // redirect all see the platform's own origin. No CORS exists or is added.
    proxy: Object.fromEntries(
      [
        '/v1',
        '/api',
        '/healthz',
        '/api-docs',
        '/openapi.json',
        '/ingestion',
        '/workers',
      ].map((p) => [p, { target: platform, changeOrigin: false }]),
    ),
  },
});
