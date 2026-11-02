import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * E2E for the SDK local viewer against the REAL Python SDK server (UIServer + a real
 * Evaluator), not Vite. The fixture (frontend/scripts/sdk_viewer_fixture.py) owns a control
 * API on 8820 that starts the scenarios; the viewer itself is served on 8818 (live) and
 * 8819 (saved files) from packages/sdk/qym/_static/ui, so run `npm run build:sdk` first.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
// Worktrees have no .venv of their own: honour QYM_PYTHON, else the repo venv, else the active python.
const repoVenv = path.join(repo, '.venv', 'bin', 'python');
const venvPython = process.env.QYM_PYTHON ?? (fs.existsSync(repoVenv) ? repoVenv : 'python');

export const LIVE_PORT = 8818;
export const FILE_PORT = 8819;
export const CONTROL_PORT = 8820;

export default defineConfig({
  testDir: './e2e/sdk-viewer',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  outputDir: 'test-results/sdk-viewer',
  use: {
    baseURL: `http://127.0.0.1:${LIVE_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `cd ${repo} && PYTHONPATH=packages/sdk:packages/platform ${venvPython} frontend/scripts/sdk_viewer_fixture.py`,
    url: `http://127.0.0.1:${CONTROL_PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
