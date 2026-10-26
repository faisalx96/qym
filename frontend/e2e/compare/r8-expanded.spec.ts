/** Round 8: the expanded item (C-exp-1..7): stacked input / expected, toggles, one aligned row of output cards, metric details. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { client, itemDetail, itemHead } from './support';
import { createApiKey, seedTracedRun } from './seed';
import { box, noSidewaysScroll, openCompare, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
let traced = '';
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-exp');
  traced = await seedTracedRun(client, await createApiKey(client, s.seed.projectId), 'r8-traced');
});

const open = async (page: Page, refs: string[], width: number, id = 'cmp-001') => {
  await openCompare(page, refs, width);
  await itemHead(page, id).click();
  const detail = itemDetail(page, id);
  await expect(detail.getByTestId('output-card')).toHaveCount(refs.length);
  return detail;
};

test('C-exp-1: INPUT, EXPECTED OUTPUT, tags and OUTPUT are stacked full-width blocks', async ({ page }) => {
  const detail = await open(page, s.four, 1440);
  const input = detail.locator('section[data-kind="input"]');
  const expected = detail.locator('section[data-kind="expected"]');
  const [bi, be, bd] = [await box(input), await box(expected), await box(detail)];
  expect(be.y).toBeGreaterThanOrEqual(bi.bottom);
  within(bi.w, be.w, 1, 'same width');
  expect(bi.w).toBeGreaterThan(bd.w - 40);
  const css = async (l: Locator) => l.evaluate((e) => ({ w: getComputedStyle(e).borderInlineStartWidth, c: getComputedStyle(e).borderInlineStartColor, bg: getComputedStyle(e).backgroundColor }));
  expect((await css(input)).w).toBe('3px');
  expect((await css(expected)).w).toBe('3px');
  expect((await css(expected)).c).not.toBe((await css(input)).c);
  const label = await input.locator('span').first().evaluate((e) => ({ s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight, t: getComputedStyle(e).textTransform }));
  expect(label.s).toBe('11px');
  expect(Number(label.w)).toBe(650);
  expect(label.t).toBe('uppercase');
  for (const b of await input.getByRole('button').all()) within((await box(b)).h, 24, 1, 'copy button');
  await expect(input).toContainText('Question 1');
  await expect(expected).toContainText('Clause 0 requires written approval.');
  expect((await box(part(page, 'output-toggles'))).y).toBeGreaterThan(be.bottom);
});

test('C-exp-2: one 24 px toggle per run with aria-pressed; at least one stays on; All and Only differing', async ({ page }) => {
  const detail = await open(page, s.four, 1440);
  const toggles = detail.locator('[data-part="output-toggle"]');
  await expect(toggles).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    within((await box(toggles.nth(i))).h, 24, 2, 'toggle');
    await expect(toggles.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await toggles.nth(1).click();
  await expect(toggles.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(detail.getByTestId('output-card')).toHaveCount(3);
  for (const i of [0, 2]) await toggles.nth(i).click();
  await expect(detail.getByTestId('output-card')).toHaveCount(1); // the last one stays on
  await toggles.nth(3).click();
  await expect(detail.getByTestId('output-card')).toHaveCount(1);
  await expect(toggles.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await detail.getByRole('button', { name: 'All', exact: true }).click();
  await expect(detail.getByTestId('output-card')).toHaveCount(4);
  await detail.getByRole('button', { name: 'Only differing' }).click();
  expect(await detail.getByTestId('output-card').count()).toBeGreaterThanOrEqual(1);
});

test('C-exp-3: 4 columns of 284 at 1440 without scroll; 5+ scroll with snap; 1024 scrolls; 390 stacks', async ({ page }) => {
  let detail = await open(page, s.four, 1440);
  let grid = detail.locator('[data-part="output-grid"]');
  const cards = detail.getByTestId('output-card');
  for (let i = 0; i < 4; i++) within((await box(cards.nth(i))).w, 284, 4, `card ${i}`);
  const xs = await cards.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
  expect(xs).toBe(1);
  let [sw, cw] = await grid.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  detail = await open(page, s.eight, 1440);
  grid = detail.locator('[data-part="output-grid"]');
  [sw, cw] = await grid.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeGreaterThan(cw);
  expect(await grid.evaluate((e) => getComputedStyle(e).scrollSnapType)).toMatch(/x/);
  await noSidewaysScroll(page);
  detail = await open(page, s.four, 1024);
  grid = detail.locator('[data-part="output-grid"]');
  [sw, cw] = await grid.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeGreaterThan(cw);
  await noSidewaysScroll(page);
  detail = await open(page, s.four, 390);
  const tops = await detail.getByTestId('output-card').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size);
  expect(tops).toBe(4);
  grid = detail.locator('[data-part="output-grid"]');
  [sw, cw] = await grid.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  await noSidewaysScroll(page);
});

test('C-exp-4/5: the cards share their rows (0 px) and one height; the head is the same in every card', async ({ page }) => {
  const detail = await open(page, s.four, 1440);
  const tops = (sel: string) =>
    detail.locator(`[data-part="output-card"] ${sel}`).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  for (const sel of ['[data-part="output-text"]', '[data-part="metric-rows"]', '[data-part="metric-details"]'])
    expect(new Set(await tops(sel)).size, sel).toBe(1);
  const hs = await detail.getByTestId('output-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(new Set(hs).size).toBe(1);
  within(hs[0]!, 226, 6, 'card height with 2 metrics (amended from 268: one-line outputs)');
  const heads = await detail.locator('[data-part="output-card-head"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(new Set(heads).size).toBe(1);
  // 3 px rail in the run colour, never red or green; 1 px subtle border elsewhere
  const rails = await detail.getByTestId('output-card').evaluateAll((els) =>
    els.map((e) => {
      const c = getComputedStyle(e);
      return { w: c.borderInlineStartWidth, c: c.borderInlineStartColor, t: c.borderTopWidth };
    }),
  );
  for (const r of rails) {
    expect(r.w).toBe('3px');
    expect(r.t).toBe('1px');
  }
  expect(new Set(rails.map((r) => r.c)).size).toBe(4);
  // the second line: Pass / Fail tag, Best tag (a unique best only), latency
  await expect(detail.getByTestId('output-card').first().locator('[data-part="output-card-head"]')).toContainText(/Pass|Fail/);
  expect(await detail.getByText('Best', { exact: false }).count()).toBeLessThanOrEqual(1);
});

test('C-exp-6: a metric row is 32 high; one click opens that metric under every run at the same top; again closes all', async ({
  page,
}) => {
  const detail = await open(page, s.four, 1440);
  const rows = detail.getByTestId('output-card').first().locator('[data-part="metric-rows"] [role="listitem"] > div').first();
  within((await box(rows)).h, 32, 1, 'metric row');
  const btns = detail.getByRole('button', { name: 'Show quality details' });
  await expect(btns).toHaveCount(4);
  await btns.first().click();
  for (let i = 0; i < 4; i++) await expect(detail.getByRole('button', { name: 'Hide quality details' }).nth(i)).toHaveAttribute('aria-expanded', 'true');
  const details = detail.locator('[data-part="metric-details"]');
  const tops = await details.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  for (const d of await details.all()) expect((await box(d)).h).toBeGreaterThanOrEqual(56);
  await expect(detail.getByTestId('metric-panel-cell')).toHaveCount(4);
  await detail.getByRole('button', { name: 'Hide quality details' }).first().click();
  await expect(detail.getByTestId('metric-panel-cell')).toHaveCount(0);
  await expect(btns).toHaveCount(4);
});

test('C-exp-7: Trace opens the existing drawer; Add issue opens the dialog and focus returns to its opener', async ({
  page,
}) => {
  const detail = await open(page, [traced, s.seed.runs.base], 1440, 'cmp-010');
  const trace = detail.locator(`[data-testid="output-card"][data-run="${traced}"]`).getByRole('button', { name: 'Trace' });
  within((await box(trace)).h, 24, 1, 'Trace button');
  await trace.click();
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('trace-drawer')).toHaveCount(0);
  await expect(trace).toBeFocused();
  const add = detail.getByRole('button', { name: 'Add issue' }).first();
  await add.click();
  await expect(page.getByTestId('issue-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('issue-dialog')).toHaveCount(0);
  await expect(add).toBeFocused();
});
