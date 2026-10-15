/// <reference lib="dom" />
/**
 * Run-detail e2e support: seeding per spec file (through the public RunEventV1 API,
 * see seed.ts) and small page helpers. Each spec file seeds its own project so
 * files never share mutable runs (score edits, issues).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createApiKey,
  ensureProject,
  seedArabicRepeatRun,
  seedClassicRun,
  seedManyCategories,
  seedRepeatRun,
  seedWideRepeatRun,
  submitRun,
  type ClassicOptions,
  type SeedClient,
} from './seed';
import { uniqueSlug } from '../helpers';

export { axeSeriousViolations, describeViolations } from '../shell/support';

export const BASE_URL = `http://127.0.0.1:${process.env.QYM_VITE_PORT ?? '5800'}`;
export const client: SeedClient = { baseUrl: BASE_URL };

export interface Seeded {
  slug: string;
  projectId: string;
  token: string;
}

export async function seedProject(prefix: string): Promise<Seeded> {
  const slug = uniqueSlug(prefix);
  const project = await ensureProject(client, `Run detail ${prefix}`, slug);
  const token = await createApiKey(client, project.id);
  return { slug, projectId: project.id, token };
}

export async function seedClassic(s: Seeded, opts: ClassicOptions = {}): Promise<string> {
  return seedClassicRun(client, s.token, opts);
}

export async function seedRepeat(s: Seeded): Promise<string> {
  return seedRepeatRun(client, s.token);
}

/** 12 items x 3 passes, Arabic prose, JSON inputs and outputs, a trace per pass. */
export async function seedArabic(s: Seeded): Promise<string> {
  return seedArabicRepeatRun(client, s.token);
}

/** 10 passes x 24 items x 24 metrics, Arabic and English items, nested JSON outputs (round 3). */
export async function seedWideRepeat(s: Seeded): Promise<string> {
  return seedWideRepeatRun(client, s.token);
}

/** 300 items with metadata keys of 24 / 14 / 9 / 6 / 4 values. */
export async function seedCategories(s: Seeded): Promise<string> {
  return seedManyCategories(client, s.token);
}

/** A small COMPLETED run that is then submitted for review (scores locked). */
export async function seedLocked(s: Seeded): Promise<string> {
  const id = await seedClassicRun(client, s.token, {
    items: 12,
    taskErrors: 1,
    scorerErrors: 1,
    retries: 0,
    notReceived: 0,
    traced: 2,
    runName: 'locked-small',
  });
  await submitRun(client, id);
  return id;
}

export function runUrl(slug: string, runId: string, query = ''): string {
  return `/projects/${slug}/runs/${runId}${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`;
}

/** Open the run page and wait until the items table has rendered. */
export async function openRun(page: Page, slug: string, runId: string, query = ''): Promise<void> {
  await page.goto(runUrl(slug, runId, query));
  await expect(page.getByTestId('items-count')).toBeVisible();
  await expect(
    page
      .getByRole('treegrid', { name: 'Items' })
      .or(page.getByRole('grid', { name: /by item and pass/ }))
      // below 640 px the rows are cards
      .or(page.getByRole('list', { name: 'Items' })),
  ).toBeVisible();
}

/** The table sits below the report sections; its rows are virtualized, so bring it into view before reading them. */
export async function showItems(page: Page): Promise<void> {
  await page.locator('#run-items').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
  await expect(page.getByRole('button', { name: /^Open item #\d+$/ }).first()).toBeVisible();
}

/** Open the item's closed "Root cause" disclosure (its per-metric cards are inside). */
export async function openRootCause(card: Locator): Promise<void> {
  const trigger = card.getByRole('button', { name: /^Root cause/ });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

export function itemRow(page: Page, n: number): Locator {
  return page.getByRole('row', { name: new RegExp(`^Open item #${n} `) });
}

export function itemButton(page: Page, n: number): Locator {
  return page.getByRole('button', { name: `Open item #${n}`, exact: true });
}

export function metricCard(page: Page, metric: string): Locator {
  return page.locator(`[data-testid=metric-card][data-metric="${metric}"]`);
}

/** Current URL search params. */
export function params(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

/** "N of M items" -> [N, M]. */
export async function itemsCount(page: Page): Promise<[number, number]> {
  const text = (await page.getByTestId('items-count').innerText()).replace(/,/g, '');
  const m = /(\d+) of (\d+) items/.exec(text);
  if (!m) throw new Error(`unexpected items-count text: ${text}`);
  return [Number(m[1]), Number(m[2])];
}

/** React Aria Select: open the button and pick the option by name. */
export async function chooseOption(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole('option', { name: option }).first().click();
}

/** Scroll position of the page's single scroller (the shell's main#shell-content). */
export async function scrollTop(page: Page): Promise<number> {
  return page.evaluate(() => document.getElementById('shell-content')?.scrollTop ?? window.scrollY);
}

/**
 * The e2e platform runs with QYM_ROLE=api (no background loops), so the Runs-list projection that
 * feeds the pager is only filled when the dashboard worker is ticked. Do that out of process.
 * Override QYM_E2E_DB_URL / QYM_E2E_PYTHON when the platform was started by hand.
 */
export function settleDashboard(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, '..', '..', '..');
  // Worktrees have no .venv of their own: QYM_E2E_PYTHON, else QYM_PYTHON, else the repo venv, else python.
  const repoVenv = path.join(repo, '.venv', 'bin', 'python');
  const python =
    process.env.QYM_E2E_PYTHON ?? process.env.QYM_PYTHON ?? (fs.existsSync(repoVenv) ? repoVenv : 'python');
  const db =
    process.env.QYM_E2E_DB_URL ??
    `sqlite:///${process.env.QYM_E2E_DB ?? path.resolve(here, '..', '..', '.qym-e2e.db')}`;
  execFileSync(python, [path.join(here, 'dashboard_tick.py')], {
    cwd: repo,
    stdio: 'pipe',
    env: {
      ...process.env,
      PYTHONPATH: 'packages/sdk:packages/platform',
      QYM_DATABASE_URL: db,
      QYM_ENVIRONMENT: 'test',
      QYM_LLM_CONFIG_ENCRYPTION_KEY:
        process.env.QYM_LLM_CONFIG_ENCRYPTION_KEY ?? 'nhrVWj9_tg4JBetyZrLyHLQTy9-5DTMysJYeRSS5flY=',
    },
  });
}
