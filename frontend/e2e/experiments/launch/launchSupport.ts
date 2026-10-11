/* eslint-disable @typescript-eslint/no-explicit-any -- request/response bodies are untyped JSON here */
/** Launch-form e2e helpers (seeding on top of ../support.ts, request capture, secret scans). */
import { expect, type APIRequestContext, type Page, type Request } from '@playwright/test';
import {
  createEnvironment,
  experimentSpec,
  publishDefaultPreset,
  saveSavedPreset,
  seedProject,
  type Seeded,
  type SeededEnv,
} from '../support';

export const APP_BASE = '/app';
export const launchUrl = (slug: string, q = '') => `/projects/${slug}/experiments/new${q}`;

export async function createDataset(
  request: APIRequestContext,
  slug: string,
  name = 'golden',
): Promise<void> {
  const res = await request.post('/v1/datasets', { data: { project_slug: slug, name, description: 'e2e' } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export interface LaunchFixture extends Seeded {
  env: SeededEnv;
  bare: SeededEnv;
}

/** Project + connection + dataset + an env with a default preset (v1) + a saved preset + a bare env. */
export async function seedLaunch(
  request: APIRequestContext,
  opts: { maxPriority?: 'LOW' | 'NORMAL' | 'HIGH'; timeout?: number | { sweep: number[] } } = {},
): Promise<LaunchFixture> {
  const s = await seedProject(request, 'launch');
  await createDataset(request, s.project.slug);
  const env = await createEnvironment(request, s.project.id, 'Alpha', {
    maxPriority: opts.maxPriority ?? 'HIGH',
  });
  await publishDefaultPreset(
    request,
    s.project.id,
    env.id,
    experimentSpec(s.connectionId, opts.timeout ?? 60),
  );
  await saveSavedPreset(request, s.project.id, env.id, 'Slow timeout', experimentSpec(s.connectionId, 120));
  const bare = await createEnvironment(request, s.project.id, 'Bare');
  return { ...s, env, bare };
}

export interface Captured {
  dryRuns: { at: number; body: any }[];
  launches: { at: number; body: any }[];
}

/** Records every POST to .../experiments (dry-run and real) with a timestamp. */
export function captureExperimentPosts(page: Page): Captured {
  const out: Captured = { dryRuns: [], launches: [] };
  page.on('request', (req: Request) => {
    if (req.method() !== 'POST' || !/\/v1\/projects\/[^/]+\/experiments(\?.*)?$/.test(req.url())) return;
    let body: any = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    (body?.dry_run ? out.dryRuns : out.launches).push({ at: Date.now(), body });
  });
  return out;
}

/** Everything a key could leak into: DOM text + values, URL, storage. */
export async function scanForSecret(page: Page, secret: string): Promise<string[]> {
  return page.evaluate((needle) => {
    const hits: string[] = [];
    if (document.documentElement.outerHTML.includes(needle)) hits.push('outerHTML');
    for (const el of Array.from(document.querySelectorAll('input,textarea')) as HTMLInputElement[]) {
      if (el.type !== 'password' && el.value.includes(needle))
        hits.push(`value:${el.name || el.id || el.type}`);
    }
    // CodeMirror holds its text in the DOM, covered by outerHTML. Storage + URL:
    if (location.href.includes(needle)) hits.push('url');
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)!;
        if (k.includes(needle) || (store.getItem(k) ?? '').includes(needle)) hits.push(`storage:${k}`);
      }
    }
    return hits;
  }, secret);
}

/** Collects console messages so specs can assert no secrets were logged. */
export function captureConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  return lines;
}

export async function listPresets(
  request: APIRequestContext,
  projectId: string,
  envId: string,
): Promise<{ id: string; kind: string; name: string; current_version?: number | null }[]> {
  const res = await request.get(`/v1/projects/${projectId}/eval-environments/${envId}/presets`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { presets: any[] }).presets;
}

import type { Locator } from '@playwright/test';

export async function openLaunch(page: Page, slug: string, q = ''): Promise<void> {
  await page.goto(APP_BASE + launchUrl(slug, q));
  await expect(page.getByRole('textbox', { name: 'Experiment name' })).toBeVisible();
}

export const nameBox = (page: Page): Locator => page.getByRole('textbox', { name: 'Experiment name' });
export const dialog = (page: Page): Locator => page.locator('[role="dialog"],[role="alertdialog"]').last();
export const review = (page: Page): Locator => page.getByRole('complementary', { name: 'Review' });
/** The Review pane's Launch button (the mobile bar has its own). */
export const launchButton = (page: Page): Locator => review(page).getByRole('button', { name: /^Launch/ });

/** Opens a collapsed section / settings group heading button (no-op when already open). */
export async function ensureOpen(button: Locator): Promise<void> {
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
}

export async function openSection(page: Page, title: string): Promise<Locator> {
  const region = page.getByRole('region', { name: new RegExp(`^${title}`) });
  await ensureOpen(region.getByRole('heading', { level: 3 }).getByRole('button'));
  return region;
}

export async function openGroup(page: Page, title: string): Promise<void> {
  await ensureOpen(page.getByRole('heading', { name: title, level: 4 }).getByRole('button'));
}

/** Waits until the review pane's dry run settled to Ready. */
export async function expectReady(page: Page): Promise<void> {
  await expect(review(page).getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
}

/** Max Attempts of the primary endpoint: an integer setting nobody sets in the seeded presets. */
export async function maxAttempts(page: Page): Promise<Locator> {
  await openSection(page, 'Environment configurations');
  await openGroup(page, 'LLM routing');
  return page.getByRole('textbox', { name: 'Max Attempts' });
}

/** Segmented radios hide their input behind a label: click the label, like a user. */
export async function pickRadio(scope: Locator, name: string | RegExp): Promise<void> {
  await scope.locator('label').filter({ hasText: name }).first().click();
}
