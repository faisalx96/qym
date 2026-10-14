import { defineConfig } from 'vitest/config';
import { workersFromMemory } from './scripts/workers-from-memory';
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
    // Bound the worker pool from the machine's free memory: jsdom workers take
    // 300-500 MB each and the default (one per CPU) has OOM-killed a 15 GB host when
    // several suites ran at once. VITEST_MAX_WORKERS overrides (scripts/heavy.sh sets it).
    maxWorkers: workersFromMemory(process.env.VITEST_MAX_WORKERS, 0.6, 4),
  },
});
