/** Redesign 2, trace drawer: split pane resize and persistence, header chips and ID copy, expand dialog, kind icons, 390px switch. */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  openRun,
  seedClassic,
  seedProject,
  showItems,
  type Seeded,
} from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-r2-trace');
  classic = await seedClassic(s, { items: 24, traced: 6 });
});

const openTrace = async (page: Page) => {
  await showItems(page);
  await page.getByRole('button', { name: 'Open trace of item #1', exact: true }).first().click();
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
};
const pct = async (page: Page) => Number(await page.getByRole('separator').getAttribute('aria-valuenow'));

test('the split is draggable by keyboard, remembered after a reload, and a double click resets it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const handle = page.getByRole('separator', { name: /Resize/ });
  expect(await pct(page)).toBe(55);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => pct(page)).toBe(51);
  await page.keyboard.press('Home');
  const min = await pct(page);
  expect(min).toBeLessThan(40);
  await page.keyboard.press('End');
  expect(await pct(page)).toBeGreaterThan(60);
  // drag
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 100, { steps: 6 });
  await page.mouse.up();
  const dragged = await pct(page);
  expect(dragged).toBeLessThan(60);
  await page.reload();
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  await expect.poll(() => pct(page)).toBe(dragged);
  await page.getByRole('separator').dblclick();
  await expect.poll(() => pct(page)).toBe(55);
});

test('the header carries the trace statistics and a copyable id; rows have kind icons', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const summary = page.getByRole('group', { name: 'Trace summary' });
  await expect(summary).toContainText('spans');
  await expect(summary).toContainText('tokens');
  await expect(summary.getByText(/^ID /)).toBeVisible();
  await summary.getByRole('button', { name: 'Copy trace id' }).click();
  await expect(summary.getByRole('button', { name: 'Copied' })).toBeVisible();
  const kinds = await page.getByRole('tree', { name: 'Span tree' }).locator('[data-kind] svg').count();
  expect(kinds).toBeGreaterThan(3);
  const w = await page.getByRole('dialog', { name: 'Trace' }).boundingBox();
  expect(w!.width).toBeGreaterThan(1250);
});

test('Input and Output blocks copy and expand into a dialog and focus returns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const detail = page.getByRole('region', { name: 'Span details' });
  await expect(detail.getByRole('region', { name: 'INPUT' })).toBeVisible();
  const expand = detail.getByRole('button', { name: 'Expand input' });
  await expand.click();
  const dlg = page.getByRole('dialog', { name: 'INPUT' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(expand).toBeFocused();
});

test('at 390px the drawer is full width with a Tree / Detail switch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const dlg = page.getByRole('dialog', { name: 'Trace' });
  expect((await dlg.boundingBox())!.width).toBeGreaterThanOrEqual(389);
  await expect(page.getByRole('separator')).toHaveCount(0);
  const view = page.getByRole('radiogroup', { name: 'Trace view' });
  await expect(view.getByRole('radio', { name: 'Tree' })).toBeChecked();
  await page.getByRole('tree', { name: 'Span tree' }).getByRole('treeitem').nth(1).click();
  await expect(view.getByRole('radio', { name: 'Detail' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Span details' })).toBeVisible();
  await view.getByRole('radio', { name: 'Tree' }).click({ force: true });
  await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
  const bad = (await axeSeriousViolations(page, '[data-testid=trace-drawer]')).filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(bad, describeViolations(bad)).toEqual([]);
});
