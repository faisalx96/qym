/** Redesign 2, trace drawer: split pane resize and persistence, the stat strip and ID copy, expand dialog, kind icons, 390px switch. */
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
const pct = async (page: Page) =>
  Number(await page.getByTestId('split-handle').getAttribute('aria-valuenow'));

test('the split is draggable by keyboard, remembered after a reload, and a double click resets it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const handle = page.getByTestId('split-handle');
  // round 3 T1: the tree takes 45% by default, so the details get the room
  expect(await pct(page)).toBe(45);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => pct(page)).toBe(41);
  await page.keyboard.press('Home');
  const min = await pct(page);
  expect(min).toBeLessThan(40);
  await page.keyboard.press('End');
  const max = await pct(page);
  expect(max).toBeGreaterThan(60);
  // drag
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 100, { steps: 6 });
  await page.mouse.up();
  const dragged = await pct(page);
  expect(dragged).toBeLessThan(max - 5);
  await page.reload();
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  await expect.poll(() => pct(page)).toBe(dragged);
  await page.getByTestId('split-handle').dblclick();
  await expect.poll(() => pct(page)).toBe(45);
});

test('the drawer carries the trace statistics in a stat strip and a copyable id in its header; rows have kind icons', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  // the facts are the platform stat strip; the trace id and its copy tile are in the drawer header
  const summary = page.getByLabel('Trace summary');
  await expect(summary).toContainText('Spans');
  await expect(summary).toContainText('Tokens');
  const dialog = page.getByRole('dialog', { name: 'Trace' });
  await dialog.getByRole('button', { name: 'Copy trace id' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
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
  await openRun(page, s.slug, classic, 'trace=item-0001');
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
  const dlg = page.getByRole('dialog', { name: 'Trace' });
  expect((await dlg.boundingBox())!.width).toBeGreaterThanOrEqual(388);
  await expect(page.getByTestId('split-handle')).toHaveCount(0);
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

test('round 3 T1: the drawer takes the full width and gives it back, and its edge resizes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const dlg = page.getByRole('dialog', { name: 'Trace' });
  const width = async () => (await dlg.boundingBox())!.width;
  const normal = await width();
  const wide = dlg.getByRole('button', { name: 'Use the full page width' });
  await expect(wide).toHaveAttribute('aria-pressed', 'false');
  await wide.click();
  await expect.poll(width).toBeGreaterThan(1430);
  // the tree keeps its cap: the details get the extra width
  const tree = (await dlg.getByRole('region', { name: 'Spans' }).boundingBox())!.width;
  expect(tree).toBeLessThanOrEqual(730);
  const back = dlg.getByRole('button', { name: 'Give the page its room back' });
  await expect(back).toHaveAttribute('aria-pressed', 'true');
  await back.click();
  await expect.poll(width).toBeCloseTo(normal, 0);
  const edge = page.getByRole('separator', { name: 'Resize the trace drawer' });
  await edge.focus();
  await page.keyboard.press('End');
  await expect.poll(width).toBeLessThan(730);
  await page.reload();
  await expect(page.getByTestId('trace-drawer')).toBeVisible();
  await expect.poll(width).toBeLessThan(730);
  await page.getByRole('separator', { name: 'Resize the trace drawer' }).dblclick();
  await expect.poll(width).toBeCloseTo(normal, 0);
});

test('round 3 T2: a model call reads as one thread, Input then Output, a message per role', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, classic);
  await openTrace(page);
  const detail = page.getByRole('region', { name: 'Span details' });
  await page
    .getByRole('tree', { name: 'Span tree' })
    .getByRole('treeitem', { name: /ChatOpenAI/ })
    .first()
    .click();
  await expect(detail.getByRole('tab', { name: /^Messages/ })).toHaveAttribute('aria-selected', 'true');
  const thread = detail.getByTestId('span-thread');
  await expect(thread.getByRole('region', { name: 'Input messages' })).toBeVisible();
  await expect(thread.getByRole('article').first()).toBeVisible();
  await expect(detail.getByRole('tab', { name: /^Response/ })).toBeVisible();
  const bad = (await axeSeriousViolations(page, '[data-testid=trace-drawer]')).filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(bad, describeViolations(bad)).toEqual([]);
});
