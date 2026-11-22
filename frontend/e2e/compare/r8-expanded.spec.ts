/**
 * Round 8, the open item (C-exp-1..7), in the item pane at the side of the list: Input, Expected and one output block
 * for each run, the output chips, the metric details, the trace drawer and the issue dialog.
 * The old expanded row (one aligned row of output cards, C-exp-3 column widths and C-exp-4/5 shared card rows) is gone.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { client, itemDetail, itemHead, paneMetrics, paneOutputs } from './support';
import { createApiKey, seedTracedRun } from './seed';
import { box, noSidewaysScroll, openCompare, seedR8, within, type R8Seed } from './r8';

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
  await expect(paneOutputs(detail)).toHaveCount(refs.length);
  return detail;
};

test('C-exp-1: Input, then Expected, then the outputs; each block has a 3 px rail in the colour of its meaning', async ({
  page,
}) => {
  const detail = await open(page, s.four, 1440);
  const input = detail.locator('section[data-part="input"]');
  const expected = detail.locator('section[data-part="expected"]');
  const output = paneOutputs(detail).first();
  const [bi, be, bo, bd] = [await box(input), await box(expected), await box(output), await box(detail)];
  // the order of the pane: Input, Expected and the outputs each on a row of their own (feedback round 2)
  expect(be.y).toBeGreaterThanOrEqual(bi.bottom);
  expect(bo.y).toBeGreaterThanOrEqual(be.bottom);
  expect(be.w).toBeGreaterThan(bd.w - 60);
  expect(bi.w).toBeGreaterThan(bd.w - 60);
  await expect(input).toHaveAttribute('data-tone', 'info');
  await expect(expected).toHaveAttribute('data-tone', 'gold');
  const css = async (l: Locator) =>
    l.evaluate((e) => ({
      w: getComputedStyle(e).borderInlineStartWidth,
      c: getComputedStyle(e).borderInlineStartColor,
    }));
  expect((await css(input)).w).toBe('3px');
  expect((await css(expected)).w).toBe('3px');
  expect((await css(output)).w).toBe('3px');
  expect((await css(expected)).c).not.toBe((await css(input)).c);
  // the block title is the platform Eyebrow
  const label = await input
    .locator('h4 > *')
    .first()
    .evaluate((e) => ({
      s: getComputedStyle(e).fontSize,
      w: getComputedStyle(e).fontWeight,
      t: getComputedStyle(e).textTransform,
    }));
  expect(label.s).toBe('11px');
  expect(Number(label.w)).toBe(650);
  expect(label.t).toBe('uppercase');
  // the actions of a block are tiles
  for (const b of await input.getByRole('button').all()) within((await box(b)).h, 22, 2, 'action tile');
  await expect(input.getByRole('button', { name: 'Copy input' })).toBeVisible();
  await expect(expected.getByRole('button', { name: 'Copy expected output' })).toBeVisible();
  await expect(input).toContainText('Question 1');
  await expect(expected).toContainText('Clause 0 requires written approval.');
});

test('C-exp-2: above three runs, one chip per output with aria-pressed; at least one stays on; All and Only the ones that differ', async ({
  page,
}) => {
  const detail = await open(page, s.four, 1440);
  const chips = detail.getByRole('group', { name: 'Outputs in view' }).getByRole('button');
  await expect(chips).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    within((await box(chips.nth(i))).h, 20, 2, 'chip');
    await expect(chips.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(paneOutputs(detail)).toHaveCount(3);
  for (const i of [0, 2]) await chips.nth(i).click();
  await expect(paneOutputs(detail)).toHaveCount(1);
  // the last one stays on: its chip is locked (aria-disabled), a click changes nothing
  await expect(chips.nth(3)).toHaveAttribute('aria-disabled', 'true');
  await chips.nth(3).click({ force: true });
  await expect(paneOutputs(detail)).toHaveCount(1);
  await expect(chips.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await detail.getByRole('button', { name: 'All', exact: true }).click();
  await expect(paneOutputs(detail)).toHaveCount(4);
  await detail.getByRole('button', { name: 'Only the ones that differ from the baseline' }).click();
  expect(await paneOutputs(detail).count()).toBeGreaterThanOrEqual(1);
});

test('C-exp-3: the pane never makes the page scroll sideways (4 and 8 runs at 1440, 4 runs at 390); at 390 the outputs stack', async ({
  page,
}) => {
  let detail = await open(page, s.four, 1440);
  const inPane = async (pane: Locator) => {
    const g = await box(pane);
    for (const out of await paneOutputs(pane).all()) {
      const o = await box(out);
      expect(o.x).toBeGreaterThanOrEqual(g.x);
      expect(o.right).toBeLessThanOrEqual(g.right + 1);
    }
  };
  await inPane(detail);
  await noSidewaysScroll(page);
  detail = await open(page, s.eight, 1440);
  await inPane(detail);
  // above four runs the Metrics table has a row for each run: one "details" button for each run
  await expect(detail.getByRole('button', { name: 'Show the details of every run' })).toBeVisible();
  await noSidewaysScroll(page);
  detail = await open(page, s.four, 390);
  const tops = await paneOutputs(detail).evaluateAll(
    (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size,
  );
  expect(tops).toBe(4);
  await inPane(detail);
  await noSidewaysScroll(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('C-exp-4/5: the head of each output is the run name as a link, the verdict tag and the latency; the tone is the verdict', async ({
  page,
}) => {
  const detail = await open(page, s.four, 1440);
  for (const out of await paneOutputs(detail).all()) {
    // the name of the block is the run; it links to this item in that run
    await expect(out).toHaveAttribute('aria-label', /^Output of /);
    await expect(out.locator('a[data-link="name"]')).toHaveAttribute('href', /\/runs\/.+\?item=cmp-001/);
    // green is only for an output that passed, red for one that failed (or a task error)
    const tone = await out.getAttribute('data-tone');
    expect(['success', 'danger', 'neutral']).toContain(tone);
    if (tone === 'success') await expect(out.locator('header')).toContainText('Pass');
    if (tone === 'danger') await expect(out.locator('header')).toContainText(/Fail|Task error/);
  }
  // one run is the baseline: its output carries the Baseline mark
  await expect(paneOutputs(detail).locator('[data-part="baseline-tag"]')).toHaveCount(1);
});

test('C-exp-6: one button opens the details of a metric for every run in one row under the metric; again closes them', async ({
  page,
}) => {
  const detail = await open(page, s.four, 1440);
  const table = paneMetrics(detail);
  // the details are closed until the reader opens them
  const show = table.getByRole('button', { name: 'Show the details of quality', exact: true });
  await expect(show).toHaveCount(1);
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(detail.locator('[data-part="metric-details"]')).toHaveCount(0);
  await show.click();
  const hide = table.getByRole('button', { name: 'Hide the details of quality', exact: true });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  const details = detail.locator('[data-part="metric-details"]');
  await expect(details).toHaveCount(1);
  // one group of details for each run (the seed gives every quality score a judge_model)
  await expect(details.getByRole('group', { name: /^Details of quality, / })).toHaveCount(4);
  await expect(details).toContainText('gpt-5');
  await hide.click();
  await expect(details).toHaveCount(0);
  await expect(show).toHaveCount(1);
  // the header button opens every metric that has details
  await table.getByRole('button', { name: 'Show the details of every metric' }).click();
  await expect(details).not.toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Hide the details of every metric' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('C-exp-7: the Open trace tile opens the existing drawer; Add issue opens the dialog; focus returns to the opener and the pane stays', async ({
  page,
}) => {
  const detail = await open(page, [traced, s.seed.runs.base], 1440, 'cmp-010');
  // the traced run is the first run of the URL: the first output block
  const trace = paneOutputs(detail)
    .first()
    .getByRole('button', { name: /^Open the trace of / });
  within((await box(trace)).h, 22, 2, 'Open trace tile');
  await trace.click();
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  // "Open in Langfuse" is no longer supported
  await expect(page.getByRole('link', { name: /Langfuse/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('trace-drawer')).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(trace).toBeFocused();
  const add = detail.getByRole('button', { name: 'Add issue' }).first();
  await add.click();
  await expect(page.getByTestId('issue-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('issue-dialog')).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(add).toBeFocused();
});
