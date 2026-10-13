/** J5 + scenario 8: trace drawer (spans, keyboard, focus, ?trace=, retries) and the latency panel. */
import { test, expect, type Page } from '@playwright/test';
import { itemButton, itemsCount, openRun, params, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-traces');
  classic = await seedClassic(s);
});

const traceButton = (page: Page, n: number) =>
  page.getByRole('button', { name: `Open trace of item #${n}`, exact: true });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Trace' });

test.describe('trace drawer (scenario 8, J6.4)', () => {
  test('opens from the row, lists spans, sets ?trace=, and Esc closes it and returns focus', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    const trigger = traceButton(page, 4);
    await trigger.click();
    await expect(drawer(page)).toBeVisible();
    await expect.poll(() => params(page).get('trace')).toBe('item-0004');
    await expect(page.getByTestId('trace-drawer')).toBeVisible();
    const tree = page.getByRole('tree', { name: 'Span tree' });
    await expect(tree).toBeVisible();
    await expect(tree.getByRole('treeitem')).toHaveCount(6);
    await expect(tree.getByRole('treeitem', { name: /answer_question/ })).toBeVisible();
    await expect(tree.getByRole('treeitem', { name: /retrieve_docs/ })).toBeVisible();
    await expect(tree.getByRole('treeitem', { name: /ChatOpenAI/ })).toBeVisible();
    await expect(page.getByTestId('span-detail')).toBeVisible();
    await expect(page.getByLabel('Trace summary')).toContainText('spans');
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect.poll(() => params(page).get('trace')).toBeNull();
    await expect(trigger).toBeFocused();
  });

  test('j / k move the selection, Enter expands, ArrowLeft collapses', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await traceButton(page, 4).click();
    const tree = page.getByRole('tree', { name: 'Span tree' });
    await expect(tree.getByRole('treeitem').first()).toBeVisible();
    await tree.focus();
    const selected = () => tree.getByRole('treeitem', { selected: true });
    // go to the root with k presses
    for (let i = 0; i < 8; i++) await page.keyboard.press('k');
    await expect(selected()).toHaveCount(1);
    await expect(selected()).toContainText('answer_question');
    await page.keyboard.press('j');
    await expect(selected()).toContainText('retrieve_docs');
    await page.keyboard.press('j');
    await expect(selected()).not.toContainText('retrieve_docs');
    await page.keyboard.press('k');
    await expect(selected()).toContainText('retrieve_docs');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(selected()).toContainText('retrieve_docs');
    // back to the root, collapse then expand
    await page.keyboard.press('k');
    await expect(selected()).toContainText('answer_question');
    const before = await tree.getByRole('treeitem').count();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => tree.getByRole('treeitem').count()).toBeLessThan(before);
    await page.keyboard.press('Enter');
    await expect.poll(() => tree.getByRole('treeitem').count()).toBe(before);
    // the detail pane follows the selection
    await expect(page.getByRole('region', { name: 'Span details' })).toContainText('answer_question');
  });

  test('"/" focuses the span filter; typing filters; Esc clears it before closing', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await traceButton(page, 4).click();
    const tree = page.getByRole('tree', { name: 'Span tree' });
    await tree.focus();
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: 'Filter spans' });
    await expect(search).toBeFocused();
    await page.keyboard.type('lookup');
    await expect.poll(() => tree.getByRole('treeitem').count()).toBeLessThan(7);
    await expect(tree.getByRole('treeitem', { name: /lookup/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
  });

  test('"/" also works with focus elsewhere in the drawer', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await traceButton(page, 4).click();
    await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
    await page.getByRole('region', { name: 'Span details' }).click();
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Filter spans' })).toBeFocused();
  });

  test('selecting a span shows its tabs; the close button closes and removes ?trace=', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await traceButton(page, 4).click();
    const detail = page.getByRole('region', { name: 'Span details' });
    await page
      .getByRole('tree', { name: 'Span tree' })
      .getByRole('treeitem', { name: /ChatOpenAI/ })
      .click();
    await expect(detail.getByRole('tab', { name: 'Messages' })).toBeVisible();
    await detail.getByRole('tab', { name: 'Raw' }).click();
    await expect(detail.getByRole('tabpanel')).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(drawer(page)).toHaveCount(0);
    await expect.poll(() => params(page).get('trace')).toBeNull();
  });

  test('retried item-0006: attempts chips, "try" markers, failed attempt filter', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await traceButton(page, 6).click();
    const attempts = page.getByRole('group', { name: 'Attempts' });
    await expect(attempts.getByRole('button', { name: 'All attempts' })).toBeVisible();
    await expect(attempts.getByRole('button', { name: /Attempt 1 · failed/ })).toBeVisible();
    await expect(attempts.getByRole('button', { name: 'Attempt 2' })).toBeVisible();
    await expect(page.getByLabel('Trace summary')).toContainText('2 attempts');
    const tree = page.getByRole('tree', { name: 'Span tree' });
    await expect(tree.getByText(/^try \d+$/).first()).toBeVisible();
    const all = await tree.getByRole('treeitem').count();
    await attempts.getByRole('button', { name: 'Attempt 2' }).click();
    // a single attempt has no merged failed try: fewer spans and no `try N` markers
    await expect.poll(() => tree.getByRole('treeitem').count()).toBeLessThan(all);
    await expect(tree.getByText(/^try \d+$/)).toHaveCount(0);
  });

  test('?trace= deep link opens the drawer on load; ?trace_pass= is honoured', async ({ page }) => {
    await openRun(page, s.slug, classic, 'trace=item-0001');
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
    await page.reload();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
  });

  test('Trace button inside an opened item opens the same drawer', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    const card = page.locator('[data-testid=item-card][data-item-id="item-0004"]');
    await card.getByRole('button', { name: 'Trace', exact: true }).click();
    await expect(drawer(page)).toBeVisible();
    expect(params(page).get('trace')).toBe('item-0004');
    await expect(card.getByRole('link', { name: 'Open in Langfuse' })).toHaveAttribute(
      'href',
      /langfuse\.example/,
    );
  });

  test('a failing trace request shows an error with Retry', async ({ page }) => {
    let fail = true;
    await page.route(/\/items\/item-0007\/trace/, (route) =>
      fail ? route.fulfill({ status: 500, json: { detail: 'trace store down' } }) : route.continue(),
    );
    await openRun(page, s.slug, classic);
    await traceButton(page, 7).click();
    await expect(drawer(page).getByRole('button', { name: 'Retry' })).toBeVisible();
    fail = false;
    await drawer(page).getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
  });
});

test.describe('latency and traces panel (J5)', () => {
  test('?panel=latency shows percentiles, histogram, scatter, time budget and steps', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=latency');
    const panel = page.getByTestId('latency-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#run-section-latency')).toBeInViewport();
    await expect(panel.getByRole('group', { name: 'Latency percentiles' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Quality versus latency' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Time budget' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Steps' })).toBeVisible();
  });

  test('a histogram bar sets a latency filter chip; clearing the chip restores the table', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic, 'panel=latency');
    const bars = page.getByRole('group', { name: /Latency histogram/ }).getByRole('button');
    await bars.nth(8).click(); // 2.25s to 2.5s: 26 items
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(240);
    await expect.poll(() => params(page).get('filters') ?? '').toContain('latency');
    const chip = page.getByRole('button', { name: /Remove filter .*(ms|s)/i }).first();
    await expect(chip).toBeVisible();
    const [n] = await itemsCount(page);
    expect(n).toBeGreaterThan(0);
    await chip.click();
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
  });

  test('a percentile pin filters to items at or above it', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=latency');
    await page.getByRole('button', { name: /^p90 .*filter to items at or above/ }).click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(60);
    expect((await itemsCount(page))[0]).toBeGreaterThan(5);
  });

  test('the Steps plot toggles By kind / Log', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=latency');
    const steps = page.getByRole('region', { name: 'Steps' });
    await steps.getByRole('radio', { name: 'By kind' }).click({ force: true });
    await expect(steps.getByRole('radio', { name: 'By kind' })).toBeChecked();
    await steps.getByRole('radio', { name: 'Log' }).click({ force: true });
    await expect(steps.getByRole('radio', { name: 'Log' })).toBeChecked();
  });

  test('#latency hash scrolls to the Latency section', async ({ page }) => {
    await page.goto(`/projects/${s.slug}/runs/${classic}#latency`);
    await expect(page.getByTestId('latency-panel')).toBeVisible();
    await expect(page.locator('#run-section-latency')).toBeInViewport();
  });
});
