import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The platform may be mounted under QYM_ROOT_PATH (e.g. /qym). The served
// index.html gets `<base href="{root}/app/">`, so every asset URL is relative
// and resolves against it. React Router gets its basename at runtime from the
// injected window.__QYM_APP__.rootPath (see src/lib/runtime.ts).
const PLATFORM_PORT = process.env.QYM_PLATFORM_PORT ?? '8800';
const VITE_PORT = Number(process.env.QYM_VITE_PORT ?? '5800');
const platform = `http://127.0.0.1:${PLATFORM_PORT}`;

/**
 * In production the platform serves `public/` files from /app/assets/*
 * (vite copies public/assets → _static/app/assets). The dev server keeps
 * `public/` at the root, so map /app/assets/<file> back to /assets/<file>
 * when no built chunk matches.
 */
function devPublicUnderApp(): Plugin {
  return {
    name: 'qym-dev-public-under-app',
    transformIndexHtml(html) {
      // Mirror what qym_platform/api/spa.py injects in production so the client sees one shape.
      const boot = {
        rootPath: '',
        authMode: process.env.QYM_AUTH_MODE ?? 'none',
        sessionAuth: process.env.QYM_AUTH_MODE === 'oidc' || process.env.QYM_AUTH_LOCAL_ENABLED === 'true',
        environment: 'development',
      };
      return html.replace(
        '<!--__QYM_APP_BOOTSTRAP__-->',
        `<script>window.__QYM_APP__ = ${JSON.stringify(boot)};</script>`,
      );
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/app/assets/')) req.url = req.url.slice('/app'.length);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devPublicUnderApp()],
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
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          aria: ['react-aria-components'],
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
        '/static',
        '/ui',
        '/login',
        '/healthz',
        '/api-docs',
        '/openapi.json',
        '/ingestion',
        '/workers',
      ].map((p) => [p, { target: platform, changeOrigin: false }]),
    ),
  },
});
