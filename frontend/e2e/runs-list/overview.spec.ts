/** J8 / §8.9: the Overview page. */
import { test, expect } from '@playwright/test';
import { APP } from '../helpers';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import { capture, freshProject, urlParams } from './support';
import { createProject, uniqueSlug } from '../helpers';

const overviewUrl = (slug: string, qs = '') => `${APP}/projects/${slug}/overview${qs}`;

test.describe('overview (J8)', () => {
  test('KPI cards and the Live / Recent / Approved / Pending lists with their View all links', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    await page.goto(overviewUrl(s.project.slug));
    const kpis = page.getByLabel('Project KPIs');
    await expect(kpis).toBeVisible();
    for (const label of ['Runs', 'Execution success', 'Runs with errors', 'Models', 'Items'])
      await expect(kpis).toContainText(label);
    await expect(kpis).toContainText('13');
    await expect(kpis).toContainText('All runs');
    // lists
    const live = page.getByRole('region', { name: 'Live runs' });
    await expect(live.getByRole('link', { name: 'text2sql-gpt-4o-live' })).toBeVisible();
    const recent = page.getByRole('region', { name: 'Recent runs' });
    await expect(recent.getByRole('row')).toHaveCount(6); // header + 5
    const approved = page.getByRole('region', { name: 'Approved runs' });
    await expect(approved.getByRole('link', { name: 'text2sql-claude-sonnet-4-006' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pending reviews' })).toBeVisible();
    // View all hrefs
    const base = `/app/projects/${s.project.slug}`;
    const href = (name: string) =>
      page
        .getByRole('region', { name })
        .getByRole('link', { name: /View all/ })
        .getAttribute('href');
    expect(await href('Live runs')).toBe(`${base}?status=RUNNING&status=PENDING`);
    expect(await href('Recent runs')).toBe(base);
    expect(await href('Approved runs')).toBe(`${base}?status=APPROVED`);
    expect(await href('Pending reviews')).toBe(`${base}/reviews`);
    // a View all link lands on the filtered Runs list
    await page
      .getByRole('region', { name: 'Approved runs' })
      .getByRole('link', { name: /View all/ })
      .click();
    await expect(page.getByTestId('runs-table')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'status: Approved',
    );
  });

  test('trend range writes ?range= (30d is the default and writes none)', async ({ page, request }) => {
    const s = await freshProject(request, 12);
    const trend = capture(page, 'trend');
    await page.goto(overviewUrl(s.project.slug));
    const range = page.getByRole('radiogroup', { name: 'Trend range' });
    await expect(range).toBeVisible();
    await expect(range.getByRole('radio', { name: '30d' })).toBeChecked();
    await expect.poll(() => trend.all().at(-1)?.body.days).toBe(30);
    await range.getByText('90d', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('range')).toBe('90d');
    await expect.poll(() => trend.all().at(-1)?.body.days).toBe(90);
    await range.getByText('7d', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('range')).toBe('7d');
    await expect.poll(() => trend.all().at(-1)?.body.days).toBe(7);
    await range.getByText('30d', { exact: true }).click();
    await expect.poll(() => urlParams(page).has('range')).toBe(false);
    // 30 days is served from the query cache: assert the control, not a request
    await expect(range.getByRole('radio', { name: '30d' })).toBeChecked();
    // a deep link restores the choice
    await page.goto(overviewUrl(s.project.slug, '?range=90d'));
    await expect(range.getByRole('radio', { name: '90d' })).toBeChecked();
  });

  test('task/dataset select writes ?task=&dataset=, headline value and delta text render', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    const trend = capture(page, 'trend');
    await page.goto(overviewUrl(s.project.slug, '?range=90d'));
    const card = page.getByRole('region', { name: 'Trend' });
    await expect(card.getByTestId('trend-chart')).toBeVisible({ timeout: 15_000 });
    const head = (await card.innerText()).replace(/\s+/g, ' ');
    expect(head).toMatch(/\d+(\.\d)?%/); // headline value
    expect(head).toMatch(/(no previous period|[+−-]?\d+\.\d pts vs previous 90 days)/);
    expect(head).toMatch(/\d+ finished runs · execution success/);
    const select = card.getByRole('button', { name: /Task · dataset/ });
    await select.click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);
    await options.filter({ hasText: 'summarize · cnn-sample' }).click();
    await expect.poll(() => urlParams(page).get('task')).toBe('summarize');
    expect(urlParams(page).get('dataset')).toBe('cnn-sample');
    expect(urlParams(page).get('range')).toBe('90d'); // other keys preserved
    await expect
      .poll(() => trend.all().at(-1)?.body)
      .toMatchObject({ task: 'summarize', dataset: 'cnn-sample', days: 90 });
    await expect(card).toContainText('summarize on cnn-sample');
  });

  test('the empty trend explains itself when no run finished in the window', async ({ page, request }) => {
    const p = await createProject(request, 'Old runs', uniqueSlug('oldrun'));
    const { createApiKey } = await import('./seed');
    const token = await createApiKey(request, p.id);
    await seedRun(request, token, {
      name: 'ancient-run',
      task: 'text2sql',
      dataset: 'spider-dev',
      model: 'openai/gpt-4o',
      metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
      items: Array.from({ length: 4 }, () => ({ accuracy: 1, quality: 0.9, latency_s: 0.5 })),
      startedAt: new Date(Date.now() - 200 * 86_400_000),
    });
    await page.goto(overviewUrl(p.slug));
    const card = page.getByRole('region', { name: 'Trend' });
    await expect(card.getByText('No finished runs in the last 30 days')).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText(/The latest finished run is from/)).toBeVisible();
    await expect(card.getByTestId('trend-chart')).toHaveCount(0);
  });

  test('the trend chart is keyboard reachable and ArrowRight moves the readout', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    await page.goto(overviewUrl(s.project.slug, '?range=90d'));
    const fig = page.getByTestId('trend-chart');
    await expect(fig).toBeVisible({ timeout: 15_000 });
    await page.getByRole('radiogroup', { name: 'Trend range' }).getByRole('radio', { name: '90d' }).focus();
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="trend-chart"]')),
      );
    }
    expect(reached, 'Tab reaches the chart').toBe(true);
    const readout = fig.locator('[role="status"]');
    await page.keyboard.press('ArrowRight');
    await expect(readout.first()).toBeVisible();
    const a = await readout.first().innerText();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => (await readout.first().innerText()) !== a, {
        message: 'readout changed after ArrowRight',
      })
      .toBe(true);
  });

  test('Origin toggle writes ?origin= and re-queries KPIs with filters.origins', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    const kpis = capture(page, 'kpis');
    await page.goto(overviewUrl(s.project.slug));
    await expect(page.getByLabel('Project KPIs')).toBeVisible();
    const origin = page.getByRole('radiogroup', { name: 'Origin' });
    await origin.getByText('Official', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('origin')).toBe('official');
    await expect.poll(() => kpis.all().at(-1)?.body.filters?.origins).toEqual(['official']);
    await expect(page.getByLabel('Project KPIs')).toContainText('0'); // no official runs were seeded
    await origin.getByText('Local', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('origin')).toBe('local');
    await expect.poll(() => kpis.all().at(-1)?.body.filters?.origins).toEqual(['local']);
    await expect(page.getByLabel('Project KPIs')).toContainText('13');
    await origin.getByText('All', { exact: true }).click();
    await expect.poll(() => urlParams(page).has('origin')).toBe(false);
    await expect(page.getByLabel('Project KPIs')).toContainText('13'); // all runs again (served from cache)
    // the live list is scoped too
    await page.goto(overviewUrl(s.project.slug, '?origin=official'));
    await expect(page.getByRole('region', { name: 'Live runs' }).getByText('No live runs')).toBeVisible();
  });
});
