import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * E2E against the real FastAPI platform on SQLite with QYM_AUTH_MODE=none,
 * through the Vite dev server (same-origin proxy, so cookies and the write
 * guard behave as in production). Ports per the playbook: foundation =
 * platform 8800 / Vite 5800. Override with QYM_PLATFORM_PORT / QYM_VITE_PORT.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const PLATFORM_PORT = process.env.QYM_PLATFORM_PORT ?? '8800';
const VITE_PORT = process.env.QYM_VITE_PORT ?? '5800';
const AUTH_MODE = process.env.QYM_E2E_AUTH_MODE ?? 'none';
// Defaults the specs and the platform both read (override from the shell when needed).
process.env.QYM_ADMIN_BOOTSTRAP_TOKEN ??= 'e2e-bootstrap';
process.env.QYM_LLM_CONFIG_ENCRYPTION_KEY ??= 'nhrVWj9_tg4JBetyZrLyHLQTy9-5DTMysJYeRSS5flY=';
const dbFile = path.join(here, '.qym-e2e.db');
// Worktrees have no .venv of their own: honour QYM_PYTHON, else the repo venv, else the active python.
const repoVenv = path.join(repo, '.venv', 'bin', 'python');
const venvPython = process.env.QYM_PYTHON ?? (fs.existsSync(repoVenv) ? repoVenv : 'python');

export const STUB_LLM_PORT = Number(PLATFORM_PORT) + 1000;
export const BASE_URL = `http://127.0.0.1:${VITE_PORT}`;
export const APP = '/app';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/sdk-viewer/**', // own config: playwright.sdk.config.ts
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // OpenAI-compatible stub for the analyzer e2e (no real LLM key needed); see scripts/stub_llm.py.
      command: `${venvPython} scripts/stub_llm.py --port ${STUB_LLM_PORT} --delay 0.2`,
      url: `http://127.0.0.1:${STUB_LLM_PORT}/v1/models`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: [
        `rm -f ${dbFile} ${dbFile}-journal &&`,
        `cd ${repo} &&`,
        `PYTHONPATH=packages/sdk:packages/platform ${venvPython} frontend/scripts/dev_db.py sqlite:///${dbFile} &&`,
        `PYTHONPATH=packages/sdk:packages/platform`,
        `QYM_AUTH_MODE=${AUTH_MODE}`,
        AUTH_MODE === 'none' ? '' : 'QYM_AUTH_LOCAL_ENABLED=true QYM_AUTH_SESSION_SECRET=e2e-secret',
        `QYM_DATABASE_URL=sqlite:///${dbFile}`,
        `QYM_ENVIRONMENT=test`,
        `QYM_ADMIN_BOOTSTRAP_TOKEN=${process.env.QYM_ADMIN_BOOTSTRAP_TOKEN}`,
        `QYM_LLM_CONFIG_ENCRYPTION_KEY=${process.env.QYM_LLM_CONFIG_ENCRYPTION_KEY}`,
        `QYM_BASE_URL=${BASE_URL}`,
        // analyzer e2e points a project LLM connection at a local stub server (http://127.0.0.1)
        `QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true`,
        `${venvPython} -m uvicorn qym_platform.main:app --port ${PLATFORM_PORT} --log-level warning`,
      ].join(' '),
      url: `http://127.0.0.1:${PLATFORM_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `QYM_PLATFORM_PORT=${PLATFORM_PORT} QYM_VITE_PORT=${VITE_PORT} ${AUTH_MODE === 'none' ? '' : 'QYM_AUTH_MODE=proxy_headers QYM_AUTH_LOCAL_ENABLED=true'} npx vite --port ${VITE_PORT} --strictPort --host 127.0.0.1`,
      url: `${BASE_URL}/app/__ui`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
