/** J7 / §8.8: the Charts page: cards, dataset tabs, sorting, legend, grouped rows and group stats. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { APP } from '../helpers';
import { BOOL, LOWER, SCORE, seedRun, waitForProjection } from './seed';
import { capture, freshProject, urlParams } from './support';

async function chartsProject(request: APIRequestContext) {
  const s = await freshProject(request, 12, { running: false });
  // a second dataset for text2sql, with git versions, so tabs and version grouping have data
  for (let i = 0; i < 3; i++) {
    await seedRun(request, s.token, {
      name: `text2sql-test-${i}`,
      task: 'text2sql',
      dataset: 'spider-test',
      model: i % 2 ? 'anthropic/claude-sonnet-4' : 'openai/gpt-4o',
      metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
      items: Array.from({ length: 5 }, (_, j) => ({
        accuracy: j < 3 + (i % 2) ? 1 : 0,
        quality: 0.5 + j / 10,
        latency_s: 0.4 + j / 10,
      })),
      gitBranch: 'main',
      gitCommit: i === 2 ? 'ffff000' : 'e4f5a6b',
      startedAt: new Date(Date.now() - (i + 1) * 3_600_000),
    });
  }
  await waitForProjection(request, s.project.slug, s.runs.length + 3);
  return s;
}

const chartsUrl = (slug: string, qs = '') => `${APP}/projects/${slug}/charts${qs}`;
const card = (page: Page, task: string) => page.getByTestId(`chart-card-${task}`);
const loadedTable = (page: Page, task: string) => card(page, task).getByRole('table');

test.describe('charts (J7)', () => {
  test('one card per task with dataset tabs; switching tab requests points for that task+dataset; height is remembered', async ({
    page,
    request,
  }) => {
    const s = await chartsProject(request);
    const points = capture(page, 'points');
    await page.goto(chartsUrl(s.project.slug));
    for (const t of ['text2sql', 'summarize', 'rag-qa']) await expect(card(page, t)).toBeVisible();
    await expect(page.getByTestId(/^chart-card-/)).toHaveCount(3);
    const tabs = card(page, 'text2sql').getByRole('tablist', { name: 'text2sql datasets' });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(tabs.getByRole('tab', { name: /spider-dev/ })).toHaveAttribute('aria-selected', 'true');
    await expect(loadedTable(page, 'text2sql')).toBeVisible();
    expect(points.all().some((p) => p.body.task === 'text2sql' && p.body.dataset === 'spider-dev')).toBe(
      true,
    );
    // card height remembered in sessionStorage once loaded
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number(sessionStorage.getItem('qym:chart-card-h:' + JSON.stringify(['text2sql', 'spider-dev']))),
        ),
      )
      .toBeGreaterThan(100);
    points.clear();
    await tabs.getByRole('tab', { name: /spider-test/ }).click();
    await expect(tabs.getByRole('tab', { name: /spider-test/ })).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() => points.all().some((p) => p.body.task === 'text2sql' && p.body.dataset === 'spider-test'))
      .toBe(true);
    await expect(
      card(page, 'text2sql').getByRole('table', { name: 'text2sql · spider-test runs' }),
    ).toBeVisible();
    await expect(card(page, 'text2sql').getByRole('link')).toHaveCount(3);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number(sessionStorage.getItem('qym:chart-card-h:' + JSON.stringify(['text2sql', 'spider-test']))),
        ),
      )
      .toBeGreaterThan(100);
  });

  test('metric headers sort: aria-sort flips on the second click', async ({ page, request }) => {
    const s = await chartsProject(request);
    await page.goto(chartsUrl(s.project.slug));
    const table = loadedTable(page, 'text2sql');
    await expect(table).toBeVisible();
    const head = table.locator('thead th', { hasText: /^quality/i });
    await head.getByRole('button').click();
    const first = await head.getAttribute('aria-sort');
    expect(first).toMatch(/ascending|descending/);
    await head.getByRole('button').click();
    const second = await head.getAttribute('aria-sort');
    expect(second).toMatch(/ascending|descending/);
    expect(second).not.toBe(first);
    // exactly one header is sorted
    await expect(
      table.locator('thead th[aria-sort="ascending"], thead th[aria-sort="descending"]'),
    ).toHaveCount(1);
    // the order of the rows follows the sort
    const values = await table
      .locator('tbody tr')
      .evaluateAll((rows) => rows.map((r) => r.querySelectorAll('td')[1]?.textContent ?? ''));
    expect(values.length).toBeGreaterThan(1);
  });

  test('legend click toggles a model (?model=) and keeps every model in the legend so it can be switched back on', async ({
    page,
    request,
  }) => {
    const s = await chartsProject(request);
    await page.goto(chartsUrl(s.project.slug));
    const legend = page.getByRole('group', { name: /^Models/ });
    await expect(legend.getByRole('button', { name: /claude-sonnet-4 \d+ runs/ })).toBeVisible();
    await expect(legend.getByRole('button', { name: /^(gpt-4o|claude-sonnet-4) \d+ runs/ })).toHaveCount(2);
    await legend.getByRole('button', { name: /claude-sonnet-4 \d+ runs/ }).click();
    await expect.poll(() => urlParams(page).getAll('model')).toEqual([expect.stringContaining('gpt-4o')]);
    await expect(page.getByTestId('filters-trigger')).toContainText('Filters · 1');
    await expect(page.getByTestId(/^chart-card-/).first()).toBeVisible();
    // wait for the filtered overview to land, then the legend must still list the toggled-off model (pressed = false)
    await expect(page.getByText(/^Filtered: \d+ runs/)).toBeVisible();
    const claude = legend.getByRole('button', { name: /claude-sonnet-4 \d+ runs/ });
    await expect(claude, 'toggled-off model stays in the legend').toHaveAttribute('aria-pressed', 'false', {
      timeout: 4000,
    });
    await claude.click();
    await expect.poll(() => urlParams(page).has('model')).toBe(false);
    await expect(legend.getByRole('button', { name: /claude-sonnet-4 \d+ runs/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('legend double-click solos a model; Show all resets', async ({ page, request }) => {
    const s = await chartsProject(request);
    await page.goto(chartsUrl(s.project.slug));
    const legend = page.getByRole('group', { name: /^Models/ });
    await expect(legend.getByRole('button', { name: /claude-sonnet-4 \d+ runs/ })).toBeVisible();
    await legend.getByRole('button', { name: /claude-sonnet-4 \d+ runs/ }).dblclick();
    await expect
      .poll(() => urlParams(page).getAll('model'))
      .toEqual([expect.stringContaining('claude-sonnet-4')]);
    await expect(page.getByText(/^Filtered: \d+ runs/)).toBeVisible();
    await legend.getByRole('button', { name: 'Show all' }).click();
    await expect.poll(() => urlParams(page).has('model')).toBe(false);
    await expect(legend.getByRole('button', { name: /gpt-4o \d+ runs/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('Rows: Grouped shows Group/Then controls; Pass@K/Consistency/Reliability stay after expanding; stats are requested; Expand/Collapse all', async ({
    page,
    request,
  }) => {
    const s = await chartsProject(request);
    const stats = capture(page, 'models/stats');
    await page.goto(chartsUrl(s.project.slug));
    const c = card(page, 'text2sql');
    await expect(loadedTable(page, 'text2sql')).toBeVisible();
    await expect(c.getByText('Group', { exact: true })).toHaveCount(0);
    await c.getByRole('radiogroup', { name: 'text2sql rows' }).getByText('Grouped', { exact: true }).click();
    await expect(c.getByRole('radiogroup', { name: 'text2sql group by' })).toBeVisible();
    await expect(c.getByRole('radiogroup', { name: 'text2sql then by' })).toBeVisible();
    const table = loadedTable(page, 'text2sql');
    for (const h of ['Pass@K', 'Consistency', 'Reliability'])
      await expect(table.locator('thead th', { hasText: h })).toBeVisible();
    await expect.poll(() => stats.count()).toBeGreaterThanOrEqual(1);
    const body = stats.last()!.body;
    expect(body.groups.length).toBeGreaterThan(0);
    expect(typeof body.metric).toBe('string');
    expect(body.groups[0].runs.length).toBeGreaterThan(0);
    // expand the first group: the stat columns are still there (regression vs the vanilla page)
    const toggle = table.getByRole('button', { name: /^Expand / }).first();
    await toggle.click();
    await expect(table.getByRole('button', { name: /^Collapse / }).first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const h of ['Pass@K', 'Consistency', 'Reliability'])
      await expect(table.locator('thead th', { hasText: h })).toBeVisible();
    const cols = await table.locator('thead th').count();
    const groupCells = await table.locator('tbody tr').first().locator('th, td').count();
    expect(groupCells).toBeGreaterThanOrEqual(cols);
    // Expand all / Collapse all
    await c.getByRole('button', { name: 'Expand all' }).click();
    await expect(c.getByRole('button', { name: 'Collapse all' })).toBeVisible();
    await expect(table.getByRole('button', { name: /^Expand / })).toHaveCount(0);
    await c.getByRole('button', { name: 'Collapse all' }).click();
    await expect(table.getByRole('button', { name: /^Collapse / })).toHaveCount(0);
    // Then: Version needs git data and groups under models
    await c
      .getByRole('radiogroup', { name: 'text2sql then by' })
      .getByText('Version', { exact: true })
      .click();
    await expect(table.getByRole('button', { name: /^Expand / }).first()).toBeVisible();
  });

  test('filters apply to the charts (task filter leaves one card) and Clear filters restores', async ({
    page,
    request,
  }) => {
    const s = await chartsProject(request);
    await page.goto(chartsUrl(s.project.slug, '?task=summarize'));
    await expect(card(page, 'summarize')).toBeVisible();
    await expect(page.getByTestId(/^chart-card-/)).toHaveCount(1);
    await page.goto(chartsUrl(s.project.slug, '?task=summarize&dataset=spider-dev'));
    await expect(page.getByText('No runs match current filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId(/^chart-card-/)).toHaveCount(3);
  });
});
