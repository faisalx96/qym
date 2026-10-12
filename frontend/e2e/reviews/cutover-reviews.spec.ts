/// <reference lib="dom" />
/**
 * Cutover of the vanilla reviews browser tests (test_reviews_queue_browser.py,
 * test_p1b_reviews_bulk_browser.py): the queue header and paging, racing filters,
 * the keyboard focus rules, the load-failure retry, the overview deep link and the
 * All-tab bulk actions that act only on the rows they fit.
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { listCorrections } from '../datasets/support';
import { decideViaApi, seedReviews } from './support';

const rows = (page: Page) => page.locator('[data-correction-row]');
const row = (page: Page, id: number) => page.locator(`[data-correction-row="${id}"]`);
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const bulk = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });

test.describe('queue header and paging', () => {
  test('opens on the pending queue with progress, asks the server for the oldest 25 first', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvq', 30);
    for (const c of s.corrections.slice(0, 4)) await decideViaApi(request, c.id, 'approve');
    const asked: URLSearchParams[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.method() === 'GET' && u.pathname === '/api/corrections') asked.push(u.searchParams);
    });
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(tab(page, 'To review')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-reviews-page]')).toContainText('Queue: 26 to review');
    await expect(page.locator('[data-reviews-page]')).toContainText('4 of 30 reviewed');
    await expect(page.getByRole('progressbar', { name: 'Reviewed' })).toHaveAttribute('aria-valuenow', '4');
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(asked[0]!.get('status')).toBe('pending');
    expect(asked[0]!.get('sort')).toBe('oldest');
    expect(asked[0]!.get('limit')).toBe('25');
    await expect(rows(page).first()).toHaveAttribute('data-correction-row', String(s.corrections[4]!.id));
    await expect(page.getByTestId('result-count')).toHaveText('26 corrections');
  });
});

test.describe('racing and failing loads', () => {
  test('an older, slower response never replaces the list of the newer filter', async ({ page, request }) => {
    const a = await seedReviews(request, 'cvrace', 3, { task: 'text2sql' });
    await seedReviews(request, 'cvrace2', 2, { task: 'router', project: a.project });
    let first = true;
    await page.route(/\/api\/corrections\?.*search=text2sql/, async (route) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });
    await gotoApp(page, `/projects/${a.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(5);
    const search = page.getByRole('searchbox', { name: 'Search corrections' });
    await search.fill('text2sql');
    await page.waitForTimeout(600); // past the debounce: the slow request is in flight
    await search.fill('router');
    await expect(rows(page)).toHaveCount(2);
    await page.waitForTimeout(2000); // the slow response has now landed
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId('result-count')).toHaveText('2 corrections');
    for (const text of await rows(page).allInnerTexts()) expect(text).toContain('router');
  });

  test('a failed load says so and Retry loads the list', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvfail', 2);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(2);
    let failing = true;
    await page.route(/\/api\/corrections\?.*search=nothing/, async (route) => {
      if (failing) await route.fulfill({ status: 500, json: { detail: 'boom' } });
      else await route.continue();
    });
    await page.getByRole('searchbox', { name: 'Search corrections' }).fill('nothing');
    await expect(page.getByText('Couldn’t load the review queue')).toBeVisible({ timeout: 20_000 }); // react-query retries first
    await expect(rows(page)).toHaveCount(0);
    failing = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('No corrections match these filters')).toBeVisible();
    await expect(page.getByText('Couldn’t load the review queue')).toHaveCount(0);
  });

  test('a row ticked before a filter that drops it is not left selected, and the stale list is not shown while loading', async ({
    page,
    request,
  }) => {
    const a = await seedReviews(request, 'cvdim', 2, { task: 'text2sql' });
    await seedReviews(request, 'cvdim2', 2, { task: 'router', project: a.project });
    await page.route(/\/api\/corrections\?.*search=router/, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await gotoApp(page, `/projects/${a.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(4);
    const gone = rows(page).filter({ hasText: 'text2sql' }).first();
    const goneId = Number(await gone.getAttribute('data-correction-row'));
    await page.getByRole('checkbox', { name: `Select correction ${goneId}` }).check({ force: true });
    await expect(bulk(page)).toContainText('1 selected');
    await page.getByRole('searchbox', { name: 'Search corrections' }).fill('router');
    // while the new filter loads, the old list is not offered for ticking
    await expect(page.getByRole('checkbox', { name: `Select correction ${goneId}` })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, goneId)).toHaveCount(0);
    await expect(bulk(page)).not.toContainText('selected');
  });
});

test.describe('keyboard and focus', () => {
  test('mouse approve and letter keys in the All tab move on to the next card, never to <body>', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvall', 5);
    const [c0, c1, c2] = s.corrections;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(5);
    await tab(page, 'All').click();
    await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(5);
    // letter keys work straight after clicking a status tab
    await expect(row(page, c0!.id)).toHaveAttribute('data-current', '');
    await page.keyboard.press('a');
    await expect(row(page, c0!.id)).toHaveAttribute('data-status', 'approved');
    // the approved card stays in All. FINDING: the current row does not move on by itself (the old queue did), so j
    await page.keyboard.press('j');
    await expect(row(page, c1!.id)).toHaveAttribute('data-current', '');
    await page.keyboard.press('a');
    await expect(row(page, c1!.id)).toHaveAttribute('data-status', 'approved');
    await expect(tab(page, 'Approved')).toContainText('2');
    await page.keyboard.press('j');
    await expect(row(page, c2!.id)).toHaveAttribute('data-current', '');
  });

  test('a mouse approve of the current card leaves focus on the next card, not on <body>', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvmouse', 4);
    const [c0, c1] = s.corrections;
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(4);
    await page.getByRole('button', { name: `Approve correction ${c0!.id}` }).click();
    await expect(row(page, c0!.id)).toHaveCount(0);
    await expect(row(page, c1!.id)).toHaveAttribute('data-current', '');
    await expect(row(page, c1!.id).locator('[data-review-card]')).toBeFocused();
  });

  test('the status tabs are a keyboard tablist', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvtabs', 3);
    await decideViaApi(request, s.corrections[0]!.id, 'approve');
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(rows(page)).toHaveCount(2);
    await tab(page, 'To review').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Approved')).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe('deep links from the overview', () => {
  test('a pending item on the Overview opens that correction, expanded, in the queue', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvov', 3);
    await gotoApp(page, `/projects/${s.project.slug}/overview`);
    const link = page.getByRole('region', { name: 'Pending reviews' }).getByRole('link', { name: /^#\d+$/ }).first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toContain(`/projects/${s.project.slug}/reviews?`);
    expect(href).toContain('id=');
    const id = Number(new URL(href, 'http://x').searchParams.get('id'));
    await link.click();
    await expect(row(page, id)).toHaveAttribute('data-current', '');
    await expect(row(page, id)).toContainText('Linked');
    await expect(page.locator(`[data-detail-pane="${id}"]`)).toBeVisible();
    await expect(tab(page, 'To review')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('All-tab bulk actions act only on the rows they fit', () => {
  async function allTab(page: Page, slug: string) {
    await gotoApp(page, `/projects/${slug}/reviews?status=all`);
    await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');
  }

  test('approve sends only the pending rows and says how many of the selection it takes', async ({ page, request }) => {
    const s = await seedReviews(request, 'cvbulk', 5);
    const approved = s.corrections.slice(0, 3);
    const pending = s.corrections.slice(3);
    for (const c of approved) await decideViaApi(request, c.id, 'approve');
    await allTab(page, s.project.slug);
    await expect(rows(page)).toHaveCount(5);
    for (const c of s.corrections) await page.getByRole('checkbox', { name: `Select correction ${c.id}` }).check({ force: true });
    await expect(bulk(page)).toContainText('5 selected');
    await expect(page.getByTestId('bulk-approve')).toContainText('Approve (2 of 5)');
    await expect(page.getByTestId('bulk-reset')).toContainText('Reset (3 of 5)');

    const sent: { ids: number[]; action: string; expected_count: number; expected_status?: string }[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/corrections/bulk') sent.push(r.postDataJSON());
    });
    await page.getByTestId('bulk-approve').click();
    const dialog = page.getByRole('dialog', { name: 'Approve 2 corrections' });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('comment-confirm').click();
    await expect(page.getByText('2 corrections approved')).toBeVisible();
    expect(sent).toHaveLength(1);
    expect([...sent[0]!.ids].sort()).toEqual(pending.map((c) => c.id).sort());
    expect(sent[0]!.action).toBe('approve');
    expect(sent[0]!.expected_count).toBe(2);
    expect(sent[0]!.expected_status).toBeUndefined();
    for (const c of pending) await expect(row(page, c.id)).toHaveAttribute('data-status', 'approved');
    expect((await listCorrections(request, s.project.slug, 'approved')).length).toBe(5);
  });

  test('a bulk action that fits no selected row is disabled and sends nothing; Reset still goes through', async ({
    page,
    request,
  }) => {
    const s = await seedReviews(request, 'cvbulk2', 3);
    const approved = s.corrections.slice(0, 2);
    for (const c of approved) await decideViaApi(request, c.id, 'approve');
    await allTab(page, s.project.slug);
    await expect(rows(page)).toHaveCount(3);
    for (const c of approved) await page.getByRole('checkbox', { name: `Select correction ${c.id}` }).check({ force: true });
    await expect(page.getByTestId('bulk-approve')).toBeDisabled();
    await expect(page.getByTestId('bulk-reject')).toBeDisabled();
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/corrections/bulk') sent.push(r.postData() ?? '');
    });
    await row(page, approved[0]!.id).locator('[data-review-card]').focus();
    // Shift+A opens the dialog (FINDING: "Approve 0 corrections"); confirming sends nothing and names the rule.
    await page.keyboard.press('Shift+A');
    await page.getByRole('dialog', { name: /Approve/ }).getByTestId('comment-confirm').click();
    await expect(page.getByText('Approve works on pending corrections only.')).toBeVisible();
    expect(sent).toEqual([]);
    await page.getByTestId('bulk-reset').click();
    await expect(page.getByText('2 corrections reset')).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).action).toBe('reset');
  });
});
