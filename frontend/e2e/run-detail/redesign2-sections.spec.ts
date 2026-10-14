/** Redesign 2, report sections: repeat reading order, steps collapsed, deep one visual per row, categories, errors. */
import { test, expect } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  itemsCount,
  openRun,
  seedCategories,
  seedClassic,
  seedProject,
  seedRepeat,
  type Seeded,
} from './support';

let s: Seeded;
let repeat: string;
let classic: string;
let categories: string;

test.beforeAll(async () => {
  s = await seedProject('rd-r2-sections');
  repeat = await seedRepeat(s);
  classic = await seedClassic(s);
  categories = await seedCategories(s);
});

test.describe('repeat analysis', () => {
  test('reads in order: verdict, grouped stats, curve, distribution, per-pass table', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRun(page, s.slug, repeat, 'panel=repeat');
    const panel = page.getByTestId('repeat-analysis');
    await expect(panel.getByTestId('repeat-verdict')).toContainText(
      /Pass@3 .*Pass\^3 .*pts of items pass at least once/,
    );
    const strip = panel.getByRole('group', { name: 'Repeat run summary' });
    for (const g of ['Capability', 'Consistency', 'Speed and errors'])
      await expect(strip.getByRole('group', { name: g })).toBeVisible();
    const tops = async (name: string | RegExp) =>
      (await panel.getByRole(name === 'Passes' ? 'region' : 'region', { name }).boundingBox())!;
    const curve = await tops('Performance across attempts');
    const dist = await tops('Distribution of passes passed');
    const table = (await panel.getByRole('region', { name: 'Passes' }).boundingBox())!;
    // one visual per row, in this order
    expect(dist.y).toBeGreaterThan(curve.y + curve.height - 2);
    expect(table.y).toBeGreaterThan(dist.y + dist.height - 2);
    // plain-language distribution labels
    await expect(panel).toContainText('always fail');
    await expect(panel).toContainText('always pass');
    // best and worst pass on the selected metric
    await expect(panel.getByRole('table', { name: 'Passes' })).toContainText(/best|worst/);
  });
});

test.describe('steps and deep analysis', () => {
  test('Steps start collapsed, Expand all and Collapse all work', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=latency');
    const steps = page.getByRole('region', { name: 'Steps' });
    await expect(steps).toBeVisible();
    const table = steps.getByRole('table', { name: 'Step latency by call site' });
    const phases = await table.getByRole('row').count();
    // header + the phase rows only
    expect(phases).toBeLessThanOrEqual(3);
    await steps.getByRole('button', { name: 'Expand all steps' }).click();
    await expect.poll(() => table.getByRole('row').count()).toBeGreaterThan(phases);
    await steps.getByRole('button', { name: 'Collapse all steps' }).click();
    await expect.poll(() => table.getByRole('row').count()).toBe(phases);
  });

  test('Deep analysis stacks the matrix above the scatter', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRun(page, s.slug, classic, 'panel=deep');
    const matrix = page.getByRole('region', { name: 'Metric correlation' });
    const scatter = page.getByRole('region', { name: 'Metric relationship' });
    await expect(matrix).toBeVisible();
    const a = (await matrix.boundingBox())!;
    const b = (await scatter.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 2);
    expect(Math.abs(a.x - b.x)).toBeLessThan(4);
  });
});

test.describe('categories', () => {
  test('one key opens first (the widest spread), others add with "+", rows rank worst first', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRun(page, s.slug, categories, 'panel=categories');
    const group = page.getByRole('group', { name: 'Categories', exact: true });
    await expect(group).toBeVisible();
    await expect(page.getByTestId('category-insight')).toContainText('Weakest:');
    // topic has 24 values: 8 rows, then Show all
    const rows = page.getByTestId('category-row');
    await expect(rows).toHaveCount(8);
    await page.getByRole('button', { name: 'Show all 24 values' }).click();
    await expect(rows).toHaveCount(24);
    // worst first: the first row's average is the lowest
    const avg = async (i: number) => Number((await rows.nth(i).innerText()).match(/(\d+)%/)![1]);
    expect(await avg(0)).toBeLessThanOrEqual(await avg(23));
    // a baseline tick on every bar
    await expect(page.getByTestId('score-marker').first()).toBeVisible();
    // add another key
    await group.getByRole('button', { name: 'Add team' }).click();
    await expect(page.getByRole('region', { name: 'team' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'topic' })).toBeVisible();
    // a click selects only one key again
    await group.getByRole('button', { name: /^complexity/ }).click();
    await expect(page.getByRole('region', { name: 'team' })).toHaveCount(0);
  });

  test('a row filters the items and toggles off', async ({ page }) => {
    await openRun(page, s.slug, categories, 'panel=categories');
    const before = (await itemsCount(page))[0];
    const row = page.getByTestId('category-row').first();
    await row.click();
    await expect(row).toHaveAttribute('data-selected', '');
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(before);
    await row.click();
    await expect(row).not.toHaveAttribute('data-selected', '');
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(before);
  });

  test('390px: categories fold into cards, no serious axe violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openRun(page, s.slug, categories, 'panel=categories');
    await expect(page.getByTestId('category-row').first()).toBeVisible();
    const bad = (await axeSeriousViolations(page, '#run-section-categories')).filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});

test.describe('errors', () => {
  test('errors are rows that filter the items', async ({ page }) => {
    await openRun(page, s.slug, classic, 'panel=errors');
    const rows = page.getByTestId('error-card');
    await expect(rows.first()).toBeVisible();
    const before = (await itemsCount(page))[0];
    await rows.first().click();
    await expect(rows.first()).toHaveAttribute('data-selected', '');
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(before);
  });
});
