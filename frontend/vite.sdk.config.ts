import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * The SDK's offline results viewer (`qym run create --local-ui`, `qym ui FILE`).
 *
 * Output is FLAT and self-contained: index.html, app.js, app.css, favicon.svg
 * directly in packages/sdk/qym/_static/ui/ (no assets/ folder, no chunks, no
 * CDN or webfonts) because the SDK wheel ships `_static/ui/*` (one level) and
 * runs with no network. See frontend/README.md "SDK viewer".
 *
 * Dev: `npm run dev:sdk` proxies api/* to the SDK server on 127.0.0.1:8818
 * (the server sends no CORS headers). Start it with
 * `qym run create --local-ui --ui-port 8818 ...` or `qym ui FILE --port 8818`.
 */
const SDK_PORT = process.env.QYM_SDK_UI_PORT ?? '8818';
const VITE_PORT = Number(process.env.QYM_SDK_VITE_PORT ?? '5808');

export default defineConfig({
  root: fileURLToPath(new URL('./src/sdk-viewer', import.meta.url)),
  publicDir: fileURLToPath(new URL('./src/sdk-viewer/public', import.meta.url)),
  plugins: [react()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  server: {
    port: VITE_PORT,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${SDK_PORT}`, changeOrigin: false } },
  },
  build: {
    outDir: fileURLToPath(new URL('../packages/sdk/qym/_static/ui', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: (asset) => (asset.names.some((n) => n.endsWith('.css')) ? 'app.css' : '[name][extname]'),
      },
    },
  },
});
