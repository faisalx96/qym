/** Redesign 2, W2/W3: column order, freezing (cap and note), per-user persistence and Reset layout. */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  clickBox,
  describeViolations,
  openRuns,
  sharedProject,
  table,
} from './support';

const headers = (page: Page) =>
  table(page)
    .locator('thead tr:last-child th[data-col]')
    .evaluateAll((ths) => ths.map((th) => (th as HTMLElement).dataset.col!));
const menu = (page: Page) => page.getByRole('dialog', { name: 'Columns' });
const openMenu = async (page: Page) => {
  await page.getByRole('button', { name: /^Columns/ }).click();
  await expect(menu(page)).toBeVisible();
};
const handle = (page: Page, name: string) => menu(page).getByRole('button', { name: `Reorder ${name}` });
const pin = (page: Page, name: string) => menu(page).getByRole('button', { name: `Freeze ${name}` });

test.describe('runs columns layout (1280)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Space lifts a column, arrows move it, Space drops it; the table follows and a reload keeps it', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    expect(before.indexOf('owner')).toBeGreaterThan(before.indexOf('time'));
    await openMenu(page);
    await handle(page, 'Owner').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
    const after = await headers(page);
    expect(after.indexOf('owner')).toBe(before.indexOf('owner') - 3);
    // the scores keep their relative order
    expect(after.filter((c) => c.startsWith('metric-'))).toEqual(
      before.filter((c) => c.startsWith('metric-')),
    );
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(table(page)).toBeVisible();
    expect(await headers(page)).toEqual(after);
    const key = await page.evaluate(() =>
      Object.keys(localStorage).find((k) => k.startsWith('qym:data-table:v2:runs.v2')),
    );
    expect(key, 'the layout is saved under a per-user key').toMatch(/^qym:data-table:v2:runs\.v2:.+/);
  });

  test('Escape cancels a lift without changing the order', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    await handle(page, 'Date').focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    expect(await headers(page)).toEqual(before);
    await expect(menu(page)).toBeVisible();
  });

  test('the freeze toggle pins a column without moving the others; Unfreeze reverses it', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await expect(table(page).locator('thead th[data-col="model"]')).not.toHaveAttribute('data-pin', 'start');
    await openMenu(page);
    await expect(pin(page, 'Model')).toHaveAttribute('aria-pressed', 'false');
    await pin(page, 'Model').click();
    await expect(pin(page, 'Model')).toHaveAttribute('aria-pressed', 'true');
    await expect(table(page).locator('thead th[data-col="model"]')).toHaveAttribute('data-pin', 'start');
    expect((await headers(page)).slice(0, 2)).toEqual(['run', 'model']);
    await pin(page, 'Model').click();
    await expect(table(page).locator('thead th[data-col="model"]')).not.toHaveAttribute('data-pin', 'start');
  });

  test('Reset layout restores order, freezing and visibility', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    await pin(page, 'Model').click();
    await clickBox(menu(page).getByRole('checkbox', { name: 'Task', exact: true }));
    expect(await headers(page)).not.toEqual(before);
    await menu(page).getByRole('button', { name: 'Reset layout' }).click();
    expect(await headers(page)).toEqual(before);
    await expect(table(page).locator('thead th[data-col="model"]')).not.toHaveAttribute('data-pin', 'start');
  });

  test('the header menu moves a column and freezes it; Alt+Shift+Arrow moves the focused header', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    const th = table(page).locator('thead th[data-col="model"]');
    await th.focus();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    const moved = await headers(page);
    expect(moved.indexOf('model')).toBe(before.indexOf('model') - 1);
    await th.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Freeze column' }).click();
    await expect(th).toHaveAttribute('data-pin', 'start');
  });

  test('the Columns button shows a dot once the layout differs from the default', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const dot = page.getByRole('button', { name: /^Columns/ }).locator('[class*="colDot"]');
    await expect(dot).toHaveCount(0);
    await openMenu(page);
    await pin(page, 'Model').click();
    await page.keyboard.press('Escape');
    await expect(dot).toHaveCount(1);
  });

  test('axe: the Columns menu has no serious violations', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openMenu(page);
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });
});

test.describe('runs columns layout (768)', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('freezing more columns than fit says so in the menu and keeps the table scrollable', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openMenu(page);
    for (const name of ['Status', 'Date', 'Task', 'Model']) await pin(page, name).click();
    await expect(menu(page).locator('[data-col-frozen-head]')).toContainText('Not frozen at this width');
    await page.keyboard.press('Escape');
    const scroller = table(page).locator('[data-dt-scroller]');
    const frozenWidth = await scroller.evaluate((el) => {
      const cells = Array.from(el.querySelectorAll<HTMLElement>('thead th[data-pin="start"][data-col]'));
      return cells.reduce((n, c) => n + c.getBoundingClientRect().width, 0) / el.clientWidth;
    });
    expect(frozenWidth).toBeLessThan(0.75);
  });
});

test.describe('runs columns layout (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('in card mode the menu keeps visibility and hides handles and freeze toggles', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openMenu(page);
    await expect(handle(page, 'Date')).toBeHidden();
    await expect(pin(page, 'Date')).toBeHidden();
    await expect(menu(page).getByRole('checkbox', { name: 'Date', exact: true })).toBeVisible();
  });
});

test.describe('frozen headers while scrolling sideways', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('RUN and STATUS headers stay visible above the scrolled headers', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const scroller = table(page).locator('[data-dt-scroller]').first();
    await scroller.evaluate((el) => (el.scrollLeft = 600));
    for (const col of ['run', 'status']) {
      const th = table(page).locator(`thead tr:last-child th[data-col="${col}"]`);
      await expect(th).toBeVisible();
      const topmost = await th.evaluate((el) => {
        const b = el.getBoundingClientRect();
        // a point on the label side, away from the sort/menu buttons
        const hit = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
        return !!hit && el.contains(hit);
      });
      expect(topmost, `${col} header is covered by a scrolled header`).toBe(true);
    }
  });
});
