import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { docsContentPlugin } from './plugins/docs-content';

export default defineConfig({
  plugins: [react(), docsContentPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
    // Bound the worker pool: the default (one per CPU, 28 here) runs jsdom workers of
    // 300-500 MB each and has OOM-killed the machine when several suites ran at once.
    // Override with VITEST_MAX_WORKERS.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
  },
});
