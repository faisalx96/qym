/**
 * Cutover: ported from tests/platform/test_dataset_metric_colours_browser.py.
 * A score is coloured only for a metric that declares a direction: a run's own
 * row uses that run's direction, a value spanning runs uses the direction the
 * runs share (none, so no colour, when they disagree). The payloads are served
 * by the real API (pinned in tests/platform/test_native_datasets.py); here they
 * are fixed so the cells have known values and directions.
 */
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion } from './support';

const METRICS = ['acc', 'lat', 'mix'];
const SHARED: Record<string, string | null> = { acc: 'maximize', lat: 'minimize', mix: null };
const RUN_A = { acc: 'maximize', lat: 'minimize', mix: 'maximize' };
const RUN_B = { acc: 'maximize', lat: 'minimize', mix: 'minimize' };
// 0.95 is a top score when higher is better and a bottom one when lower is better.
const TOP = '5';
const BOTTOM = '1';

async function seed(page: Page, request: Parameters<typeof createProject>[0]) {
  const p = await createProject(request, 'Metric Colours', uniqueSlug('mcol'));
  const d = await createDataset(request, p.slug, 'Colours DS');
  const v = await createVersion(request, p.slug, d.slug);
  await bulkItems(request, p.slug, d.slug, v.version, [
    { item_id: 'case-1', input: 'q', expected_output: 'a' },
  ]);
  await publishVersion(request, p.slug, d.slug, v.version, true);
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const withDirs = async (route: Route, edit: (body: Record<string, unknown>) => void) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    edit(body);
    await route.fulfill(json(body));
  };
  const scores = METRICS.map((m) => ({ metric_name: m, score_numeric: 0.95, score_raw: null }));
  const metricAvg = Object.fromEntries(METRICS.map((m) => [m, { avg: 0.95 }]));
  await page.route(/\/v1\/datasets\/[^/]+\/versions\/[^/]+\/items\?/, (route) =>
    withDirs(route, (body) => {
      body.metric_names = METRICS;
      body.metric_directions = SHARED;
      body.items = [
        {
          id: 1,
          item_id: 'case-1',
          index: 0,
          input: 'q',
          expected_output: 'a',
          metadata: {},
          labels: [],
          result_summary: { run_count: 2, metrics: metricAvg },
        },
      ];
      body.total = 1;
    }),
  );
  await page.route(/\/v1\/datasets\/[^/]+\/runs\?/, (route) =>
    route.fulfill(
      json({
        runs: [
          {
            id: 'run-a',
            run_name: 'run-a',
            status: 'COMPLETED',
            version_label: 'v1',
            metric_averages: { acc: 0.95, lat: 0.95, mix: 0.95 },
            metric_directions: RUN_A,
          },
          {
            id: 'run-b',
            run_name: 'run-b',
            status: 'COMPLETED',
            version_label: 'v1',
            metric_averages: { acc: 0.95, lat: 0.95, mix: 0.95 },
            metric_directions: RUN_B,
          },
        ],
        total: 2,
        metric_names: METRICS,
      }),
    ),
  );
  await page.route(/\/v1\/datasets\/[^/]+\/versions\/[^/]+\/items\/case-1\/runs/, (route) =>
    route.fulfill(
      json({
        item: { id: 1, item_id: 'case-1', index: 0 },
        aggregates: { run_count: 2, error_count: 0, metrics: metricAvg, metric_directions: SHARED },
        runs: [
          {
            run_id: 'run-a',
            run_name: 'run-a',
            status: 'COMPLETED',
            created_at: '2026-09-01T00:00:00Z',
            scores,
            metric_directions: RUN_A,
          },
          {
            run_id: 'run-b',
            run_name: 'run-b',
            status: 'COMPLETED',
            created_at: '2026-09-02T00:00:00Z',
            scores,
            metric_directions: RUN_B,
          },
        ],
      }),
    ),
  );
  return { p, d };
}

/** data-band of every ScoreValue in scope (null: no colour). */
const bandsOf = (scope: Locator) =>
  scope
    .locator('span[class*="_score_"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-band')));

async function runRows(table: Locator) {
  const out: Record<string, (string | null)[]> = {};
  for (const name of ['run-a', 'run-b']) {
    const row = table.getByRole('row').filter({ hasText: name });
    out[name] = await bandsOf(row);
  }
  return out;
}

const RUN_ROWS = { 'run-a': [TOP, BOTTOM, TOP], 'run-b': [TOP, BOTTOM, BOTTOM] };

test.describe('dataset metric colours follow the declared direction', () => {
  test('items table colours each item mean by the shared direction', async ({ page, request }) => {
    const { p, d } = await seed(page, request);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}`);
    const row = page.locator('[data-item-link="case-1"]').locator('xpath=ancestor::*[@role="row"]');
    await expect(row).toBeVisible();
    expect(await bandsOf(row)).toEqual([TOP, BOTTOM, null]);
  });

  test('runs tab colours each run by its own direction', async ({ page, request }) => {
    const { p, d } = await seed(page, request);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?tab=runs`);
    const table = page.locator('[data-dataset-runs]');
    await expect(table.getByText('run-a')).toBeVisible();
    expect(await runRows(table)).toEqual(RUN_ROWS);
  });

  test('item page runs colour tiles by the shared direction and rows by their own', async ({
    page,
    request,
  }) => {
    const { p, d } = await seed(page, request);
    await gotoApp(page, `/projects/${p.slug}/datasets/${d.slug}?item=case-1&tab=runs`);
    const strip = page.getByLabel('Run aggregates');
    await expect(strip).toBeVisible();
    expect(await bandsOf(strip)).toEqual([TOP, BOTTOM, null]);
    const table = page.getByRole('grid').last();
    await expect(table.getByText('run-a')).toBeVisible();
    expect(await runRows(table)).toEqual(RUN_ROWS);
  });
});
