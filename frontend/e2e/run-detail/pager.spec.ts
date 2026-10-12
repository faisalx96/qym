/** J9 + scenario 11: step between runs in ?list= order with the pager and the J / K shortcuts. */
import { test, expect } from '@playwright/test';
import {
  client,
  openRun,
  params,
  runUrl,
  seedClassic,
  seedProject,
  settleDashboard,
  type Seeded,
} from './support';

let s: Seeded;
let runs: string[] = [];
let order: string[] = []; // run ids in the pager's order (time-desc default)

interface Neighbors {
  previous: { run_id: string } | null;
  next: { run_id: string } | null;
  position: number | null;
  total: number;
}

async function neighbors(runId: string): Promise<Neighbors> {
  const res = await fetch(`${client.baseUrl}/api/dashboard/neighbors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_slug: s.slug, run_id: runId, filters: {}, sort: 'time-desc' }),
  });
  return (await res.json()) as Neighbors;
}

test.beforeAll(async () => {
  s = await seedProject('rd-pager');
  const small = { items: 12, taskErrors: 1, scorerErrors: 1, retries: 0, notReceived: 0, traced: 1 };
  runs = [];
  for (let i = 0; i < 4; i++) runs.push(await seedClassic(s, small));
  settleDashboard();
  // walk the order from any run: first = the one with no previous
  let cursor = runs[0]!;
  for (;;) {
    const n = await neighbors(cursor);
    if (!n.previous) break;
    cursor = n.previous.run_id;
  }
  order = [cursor];
  for (;;) {
    const n = await neighbors(order[order.length - 1]!);
    if (!n.next) break;
    order.push(n.next.run_id);
  }
});

test('the projection lists all four runs in one order', () => {
  expect(order).toHaveLength(4);
  expect(new Set(order)).toEqual(new Set(runs));
});

test.describe('pager (J9, scenario 11)', () => {
  test('hero shows "N of M" and enabled arrows between neighbours; the ends are disabled', async ({ page }) => {
    await openRun(page, s.slug, order[1]!);
    const nav = page.getByRole('navigation', { name: 'Previous and next run' });
    await expect(nav).toContainText('2 of 4');
    await expect(nav.getByRole('link', { name: /Previous run/ })).toHaveAttribute('href', new RegExp(order[0]!));
    await expect(nav.getByRole('link', { name: /Next run/ })).toHaveAttribute('href', new RegExp(order[2]!));
    await openRun(page, s.slug, order[0]!);
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('1 of 4');
    await expect(page.getByRole('link', { name: 'No previous run' })).toHaveAttribute('aria-disabled', 'true');
    await openRun(page, s.slug, order[3]!);
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('4 of 4');
    await expect(page.getByRole('link', { name: 'No next run' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('J goes to the next run, K returns, and Back restores the previous view', async ({ page }) => {
    await openRun(page, s.slug, order[1]!, 'show=failed&sort=latency_desc&metric=exact_match');
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('2 of 4');
    const beforeUrl = page.url();
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`/runs/${order[2]}`));
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('3 of 4');
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`/runs/${order[1]}`));
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('2 of 4');
    // browser Back from run 2 -> run 3, Back again -> run 2 as first opened, with its filters
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/runs/${order[2]}`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/runs/${order[1]}`));
    await expect(page.getByTestId('items-count')).toBeVisible();
    expect(params(page).get('show')).toBe('failed');
    expect(params(page).get('sort')).toBe('latency_desc');
    expect(page.url()).toBe(beforeUrl);
  });

  test('?list= carries the Runs-list context through J / K', async ({ page }) => {
    const list = encodeURIComponent('task=rag_answer&sort=time-desc');
    await page.goto(runUrl(s.slug, order[1]!, `list=${list}`));
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText(/\d of 4/);
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`/runs/${order[2]}`));
    expect(params(page).get('list')).toContain('task=rag_answer');
  });

  test('J and K are ignored while typing in the search box and with a dialog open', async ({ page }) => {
    await openRun(page, s.slug, order[1]!);
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('2 of 4');
    const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
    await search.focus();
    await page.keyboard.type('jk');
    await expect(search).toHaveValue('jk');
    await expect(page).toHaveURL(new RegExp(`/runs/${order[1]}`));
    await search.fill('');
    await page.getByTestId('csv-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`/runs/${order[1]}`));
  });

  test('clicking the next arrow navigates in-app without a full reload', async ({ page }) => {
    await openRun(page, s.slug, order[0]!);
    let loads = 0;
    page.on('load', () => loads++);
    await page.getByRole('link', { name: /Next run/ }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${order[1]}`));
    await expect(page.getByRole('navigation', { name: 'Previous and next run' })).toContainText('2 of 4');
    expect(loads).toBe(0);
  });
});
