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
  seedR7JsonKeys,
  seedR5DetailsRun,
  seedR5Passes19Run,
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

/** Round 5 runs: `details` (86 items, 11 score buckets, long judge metadata) and `passes19` (19 passes). */
export async function seedR5(s: Seeded): Promise<{ details: string; passes19: string }> {
  return {
    details: await seedR5DetailsRun(client, s.token),
    passes19: await seedR5Passes19Run(client, s.token),
  };
}

/** Round 7: twelve items with JSON keys of 10 / 40 / 80 characters, nesting and Arabic keys (j-01 English, j-03 Arabic). */
export async function seedJsonKeys(s: Seeded): Promise<string> {
  return seedR7JsonKeys(client, s.token);
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

/**
 * Go to a run section through the sticky nav (RF1, C132): the section's link when it is in the row, else the item in
 * the nav's More menu (at 1280 px the links that do not fit move there).
 */
export async function goToSection(page: Page, name: string | RegExp): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Run sections' });
  const link = nav.getByRole('link', { name });
  if (await link.count()) {
    await link.first().click();
    return;
  }
  await nav.getByTestId('nav-more').click();
  await page.getByRole('menuitem', { name }).click();
}

export function runUrl(slug: string, runId: string, query = ''): string {
  return `/projects/${slug}/runs/${runId}${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`;
}

/** The items table of the run page. It is a grid: no row expands in place since the item pane, so it is not a treegrid. */
export function itemsGrid(page: Page): Locator {
  return page.getByRole('grid', { name: 'Items' });
}

/** Open the run page and wait until the items table has rendered. */
export async function openRun(page: Page, slug: string, runId: string, query = ''): Promise<void> {
  await page.goto(runUrl(slug, runId, query));
  await expect(page.getByTestId('items-count')).toBeVisible();
  await expect(
    itemsGrid(page)
      .or(page.getByRole('grid', { name: /by item and pass/ }))
      // below 640 px the rows are cards
      .or(page.getByRole('list', { name: 'Items' })),
  ).toBeVisible();
}

/** The table sits below the report sections; its rows are virtualized, so bring it into view before reading them. */
export async function showItems(page: Page): Promise<void> {
  await page.locator('#run-items').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
  // a table row at desktop width, a card (li) below 640 px
  await expect(page.locator('#run-items [data-item-id]').first()).toBeVisible();
}

/** Open the closed "Root cause" disclosure of the item pane (its per-metric cards are inside). */
export async function openRootCause(pane: Locator): Promise<void> {
  const trigger = pane.getByRole('button', { name: /^Root cause/ });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

/** The row of item #n in the items table. A click, Enter or Space on it opens the item in the pane at the side. */
export function itemRow(page: Page, n: number): Locator {
  return page.locator('tr[data-item-id]').filter({ has: page.getByText(`#${n}`, { exact: true }) });
}

/** What opens item #n: the row itself (the table has no chevron button since the item pane). */
export function itemButton(page: Page, n: number): Locator {
  return itemRow(page, n);
}

/**
 * Click the row of item #n at its start (the # cell). Use it when the pane is open: the pane lies over the table from
 * about 240 px after the table's start edge, so a click on the centre of a row lands on the pane and Playwright waits
 * until its timeout. A click on the row of the open item closes the pane.
 */
export async function clickItemRow(page: Page, n: number): Promise<void> {
  await itemRow(page, n).click({ position: { x: 24, y: 14 } });
}

/**
 * The item pane at the side of the items table (`<aside aria-label="Item #n">`, in a portal on the body). One item is
 * open at a time. With an item id, the pane of that item only.
 */
export function itemPane(page: Page, itemId?: string): Locator {
  return itemId
    ? page.locator(`[data-testid="item-pane"][data-item-id="${itemId}"]`)
    : page.getByTestId('item-pane');
}

/** A titled block of the pane: `input`, `expected`, `output` (data-tone: info, gold, success | danger | neutral). */
export function paneBlock(pane: Locator, part: 'input' | 'expected' | 'output'): Locator {
  return pane.locator(`section[data-part="${part}"]`);
}

/** The Metrics table of the item pane (role=table; one row for each metric, a score column for each pass). */
export function metricTable(pane: Locator): Locator {
  return pane.getByRole('table', { name: 'Metrics' });
}

/** The name cell of a metric: its name, then the "edited" tag once a reviewer changed the score. */
function metricCellName(metric: string): RegExp {
  return new RegExp(`^${metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( edited)?$`);
}

/** The row of a metric in the pane's Metrics table (the row carries data-failing and data-editing). */
export function metricRow(pane: Locator, metric: string): Locator {
  return metricTable(pane)
    .getByRole('row')
    .filter({ has: pane.page().getByRole('cell', { name: metricCellName(metric) }) });
}

/**
 * Open the details of a metric (what its scorer recorded beside the reason) and return them. The details are closed
 * until the reader opens them, and the button is there only when the metric has details. For a multi-pass item, give
 * the pass: its column header puts that pass in view first (the details and the reasons are those of the pass in view).
 */
export async function openMetric(pane: Locator, metric: string, pass?: number): Promise<Locator> {
  if (pass !== undefined) {
    const head = metricTable(pane).getByRole('button', { name: new RegExp(`^Pass ${pass}\b`) });
    // up to 4 passes each have a column header button; beyond that the pass switch of the Output block picks the pass
    if (await head.count()) await head.click();
  }
  const row = metricRow(pane, metric);
  const show = row.getByRole('button', { name: `Show the details of ${metric}`, exact: true });
  if (await show.count()) await show.click();
  await expect(row.getByRole('button', { name: `Hide the details of ${metric}`, exact: true })).toBeVisible();
  const details = row.locator('[data-part="metric-details"]');
  await expect(details).toBeVisible();
  return details;
}

/** Close the item pane with its red Close tile. */
export async function closePane(page: Page): Promise<void> {
  await itemPane(page).getByRole('button', { name: 'Close item', exact: true }).click();
  await expect(itemPane(page)).toHaveCount(0);
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
