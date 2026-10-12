/** QA fix list for the SDK viewer: editable flag, Edited marker, headers, landmarks, idle `qym ui`, chips. */
import { readFileSync } from 'node:fs';
import {
  control,
  detail,
  expect,
  finishLive,
  freshFile,
  INPUT,
  FILE,
  LIVE,
  parseCsv,
  rowByInput,
  rows,
  startLive,
  test,
} from './support';
import type { Page } from '@playwright/test';

async function landmarkIssues(page: Page): Promise<string[]> {
  const axe = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  await page.addScriptTag({ content: axe });
  return page.evaluate(async () => {
    const a = (
      window as unknown as {
        axe: { run: (c: Document, o: object) => Promise<{ violations: Array<{ id: string }> }> };
      }
    ).axe;
    const res = await a.run(document, { runOnly: ['region', 'landmark-one-main', 'page-has-heading-one'] });
    return res.violations.map((v) => v.id);
  });
}

test.describe('score editing availability', () => {
  test('a file outside the results folder is read-only and says so', async ({ page, request }) => {
    const { path } = await control<{ path: string }>(request, 'POST', '/file/outside');
    await page.goto(`${FILE}/run/${encodeURIComponent(path)}`);
    await expect(rows(page)).toHaveCount(8);
    await rowByInput(page, INPUT.wrong).click();
    await expect(detail(page)).toBeVisible();
    await expect(page.getByLabel('New exact_match score')).toHaveCount(0);
    await expect(detail(page).getByText(/read-only/)).toBeVisible();
  });
});

test.describe('edited scores', () => {
  test('are marked in the list and the pane, without raw audit keys', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await rowByInput(page, INPUT.wrong).click();
    await page.getByLabel('New exact_match score').fill('1');
    await detail(page).getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved to the results file')).toBeVisible();
    await expect(detail(page).getByText('Edited', { exact: true })).toBeVisible();
    await expect(detail(page).getByText(/Original: 0/)).toBeVisible();
    await expect(detail(page).getByText('original_score')).toHaveCount(0);
    await expect(detail(page).getByText('modified', { exact: true })).toHaveCount(0);
    await expect(
      rowByInput(page, INPUT.wrong).locator('td').nth(4).locator('span[title*="edited"]'),
    ).toHaveCount(1);
  });
});

test.describe('table headers and export', () => {
  test('metric headers show their full name', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    const head = page.getByRole('columnheader', { name: /length_ratio/ });
    await expect(head).toBeVisible();
    await expect(head.locator('span').first()).toHaveCSS('white-space', 'normal');
    const text = head.locator('span').first();
    expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(head).toHaveAttribute('title', 'length_ratio');
  });

  test('the CSV carries metric meta, trace id and item id', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await rowByInput(page, INPUT.wrong).click();
    await page.getByLabel('New exact_match score').fill('1');
    await detail(page).getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved to the results file')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const table = parseCsv(readFileSync((await download.path()) as string, 'utf8'));
    expect(table[0]).toContain('trace_id');
    expect(table[0]).toContain('item_id');
    expect(table[0].some((h) => h === 'exact_match_original_score')).toBe(true);
  });
});

test.describe('landmarks and idle viewer', () => {
  test('a loaded run has a main landmark, one h1 and no region violations', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await landmarkIssues(page)).toEqual([]);
  });

  test('qym ui without a file says nothing is running instead of waiting forever', async ({
    page,
    request,
  }) => {
    await control(request, 'POST', '/ui/idle');
    await page.goto(LIVE);
    await expect(page.getByRole('heading', { name: 'No evaluation is running here' })).toBeVisible();
    await expect(page.getByText('qym ui FILE')).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No run', { exact: true })).toBeVisible();
  });
});

test.describe('summary latency', () => {
  test('lists Min with the percentiles', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await expect(rows(page)).toHaveCount(8);
    const latency = page.getByLabel('Latency', { exact: true });
    for (const k of ['Min', 'P50', 'P90', 'P99', 'Max'])
      await expect(latency.getByText(k, { exact: true })).toBeVisible();
  });
});

test.describe('live header and summary', () => {
  test('shows config chips', async ({ page, request }) => {
    await startLive(request);
    await page.goto(LIVE);
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByText('Concurrency 2')).toBeVisible();
    await expect(page.getByText(/^Timeout \d+s$/)).toBeVisible();
    await finishLive(request);
  });

  test('the elapsed clock stops while reconnecting', async ({ page, request }) => {
    await startLive(request);
    await page.goto(LIVE);
    await expect(rows(page)).toHaveCount(8);
    await control(request, 'POST', '/ui/kill');
    await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 15_000 });
    const elapsed = page.getByText(/^Elapsed/);
    const a = await elapsed.textContent();
    await page.waitForTimeout(2500);
    expect(await elapsed.textContent()).toBe(a);
  });
});
