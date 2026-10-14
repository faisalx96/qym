/// <reference lib="dom" />
/**
 * Shared helpers for the runs-list specs: a memoised seeded project per
 * worker, request capture for POST /api/dashboard/*, and small page actions.
 */
import { expect, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test';
import { APP } from '../helpers';
import { seedProjectWithRuns, waitForProjection, type SeededProjectWithRuns } from './seed';

export { axeSeriousViolations, describeViolations } from '../shell/support';

type Shared = Record<string, Promise<SeededProjectWithRuns>>;
const g = globalThis as unknown as { __runsListShared?: Shared };

/** One seeded project per (key, count) for the whole worker (read-only specs share it). */
export function sharedProject(
  request: APIRequestContext,
  count = 20,
  key = 'default',
): Promise<SeededProjectWithRuns> {
  g.__runsListShared ??= {};
  const id = `${key}:${count}`;
  g.__runsListShared[id] ??= (async () => {
    const seeded = await seedProjectWithRuns(request, { count });
    await waitForProjection(request, seeded.project.slug, seeded.runs.length);
    return seeded;
  })();
  return g.__runsListShared[id]!;
}

/** A private project for tests that mutate runs. */
export async function freshProject(
  request: APIRequestContext,
  count = 12,
  opts: { running?: boolean } = {},
): Promise<SeededProjectWithRuns> {
  const seeded = await seedProjectWithRuns(request, { count, running: opts.running });
  await waitForProjection(request, seeded.project.slug, seeded.runs.length);
  return seeded;
}

export const runsUrl = (slug: string, qs = '') =>
  `${APP}/projects/${slug}${qs ? (qs.startsWith('?') ? qs : `?${qs}`) : ''}`;

export const table = (page: Page) => page.getByTestId('runs-table');
/** Table rows; below 640 px the same rows render as cards (`li[data-run-id]`). */
export const dataRows = (page: Page) =>
  page.locator(
    '[data-testid="runs-table"] tbody tr[data-run-id], [data-testid="runs-table"] li[data-run-id]',
  );

export async function openRuns(page: Page, slug: string, qs = ''): Promise<void> {
  await page.goto(runsUrl(slug, qs));
  await expect(table(page)).toBeVisible();
  await expect(dataRows(page).first()).toBeVisible();
}

export interface Captured {
  url: string;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Records the JSON body of every POST to /api/dashboard/<endpoint>. */
export function capture(
  page: Page,
  endpoint: string,
): { all: () => Captured[]; last: () => Captured | undefined; clear: () => void; count: () => number } {
  const seen: Captured[] = [];
  page.on('request', (req: Request) => {
    if (req.method() !== 'POST' || !new URL(req.url()).pathname.endsWith(`/api/dashboard/${endpoint}`))
      return;
    try {
      seen.push({ url: req.url(), body: JSON.parse(req.postData() ?? '{}') });
    } catch {
      /* ignore */
    }
  });
  return {
    all: () => seen,
    last: () => seen[seen.length - 1],
    clear: () => void (seen.length = 0),
    count: () => seen.length,
  };
}

/** Run-list page requests only (the `ids` pinned-row lookups and Overview pages excluded). */
export const listRequests = (cap: ReturnType<typeof capture>) => cap.all().filter((c) => !c.body.ids?.length);

/** The filter bar is always on screen (desktop); this only asserts it, kept so specs read the same. */
export async function openFilters(page: Page): Promise<void> {
  await expect(page.getByTestId('filter-bar')).toBeVisible();
}

const SINGULAR: Record<string, string> = {
  Tasks: 'Task',
  Datasets: 'Dataset',
  Models: 'Model',
  Versions: 'Version',
  Status: 'Status',
  Users: 'User',
};

/**
 * Opens a facet's value list from the bar (one click) and leaves `filters-panel` visible. Versioning-key facets
 * live under `More filters`: that popover opens and the key's list expands inside it.
 */
export async function openFacet(page: Page, name: string): Promise<void> {
  const bar = page.getByTestId('filter-bar');
  await expect(bar).toBeVisible();
  const singular = SINGULAR[name];
  if (singular) {
    const trigger = bar.getByRole('button', { name: new RegExp(`^${singular} filter`) });
    if (await trigger.count()) {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await expect(page.getByTestId('filters-panel')).toBeVisible();
      return;
    }
  }
  const panel = page.getByTestId('filters-panel');
  if (!(await panel.isVisible())) await bar.getByTestId('filters-trigger').click();
  await expect(panel).toBeVisible();
  const head = panel.getByRole('button', { name: new RegExp(`^${name}\\b`) });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}

export const urlParams = (page: Page) => new URL(page.url()).searchParams;

/** Broadcast a run-status change from a second page of the same context. */
export async function broadcastRunStatus(page: Page, runIds: string[], status: string): Promise<void> {
  const other = await page.context().newPage();
  await other.goto(`${APP}/__ui`).catch(() => undefined);
  await other.evaluate(
    ([ids, st]) => {
      const ch = new BroadcastChannel('qym-run-status');
      ch.postMessage({ runIds: ids, status: st });
      ch.close();
    },
    [runIds, status] as [string[], string],
  );
  await other.close();
}

/** React Aria checkboxes hide the native input: click the wrapping label like a user does. */
export async function clickBox(box: Locator): Promise<void> {
  await box.locator('xpath=ancestor::label[1]').click();
}

/** A table row by (part of) its run name. */
export const rowOf = (page: Page, name: string): Locator =>
  page
    .locator('[data-testid="runs-table"] tbody tr[data-run-id]')
    .filter({ has: page.locator('td[data-col="run"] a', { hasText: name }) });

export const statusText = async (row: Locator): Promise<string> =>
  (await row.locator('td[data-col="status"]').innerText()).replace(/\s+/g, ' ').trim();

/** Fails the test when the page calls window.alert/confirm/prompt. */
export function failOnNativeDialogs(page: Page): { seen: () => string[] } {
  const seen: string[] = [];
  page.on('dialog', async (d) => {
    seen.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
  return { seen: () => seen };
}

/** Opens the row-actions menu of pass `n` inside a passes panel. */
export async function openPassMenu(panel: Locator, page: Page, n: number): Promise<void> {
  await panel.locator(`tr[data-pass-row="${n}"]`).getByRole('button', { name: 'Row actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}
export async function deletePassFromMenu(panel: Locator, page: Page, n: number): Promise<void> {
  await openPassMenu(panel, page, n);
  await page.getByRole('menuitem', { name: new RegExp(`^Delete pass ${n}`) }).click();
}
