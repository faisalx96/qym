import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { inlineSingleFile } from './plugins/inline-single-file';

/**
 * The exported run page (C173): today's React run page, read-only, as ONE self-contained HTML file. It is built
 * next to the app as `_static/app/export.html` (after the app build, which empties that folder) and served by
 * `GET /api/export/run-template`. "Export HTML" on the run page puts the run's data into it and downloads it.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/export', import.meta.url)),
  publicDir: false,
  plugins: [react(), inlineSingleFile()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  build: {
    outDir: fileURLToPath(new URL('../packages/platform/qym_platform/_static/app', import.meta.url)),
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/export/export.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
