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

  test('a pointer drag of the handle across several rows moves the column that far (Chromium)', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    // Date is near the top of the list, so it and the three rows above it are inside the list's visible area
    const rows = menu(page).locator('[data-col-row]');
    const ids = await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.colRow!));
    const from = ids.indexOf('time');
    expect(from).toBeGreaterThanOrEqual(3);
    const target = await rows.nth(from - 3).boundingBox();
    const grip = await handle(page, 'Date').boundingBox();
    expect(target && grip).toBeTruthy();
    // press on the handle, move up in small steps through three rows, release on the target row
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x + grip!.width / 2, target!.y + 2, { steps: 12 });
    await page.mouse.up();
    const after = await headers(page);
    expect(after.indexOf('time')).toBe(before.indexOf('time') - 3);
    expect(after.filter((c) => c.startsWith('metric-'))).toEqual(
      before.filter((c) => c.startsWith('metric-')),
    );
    await expect(menu(page)).toBeVisible();
  });

  test('a drag held at the top edge of the list scrolls it, so a column from below the fold reaches the top', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    const list = menu(page).getByRole('list', { name: 'Column order' });
    const scrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrollable, 'the runs table has more columns than the list shows at once').toBe(true);
    // Owner is below the fold: bring it into view, press its handle and hold the pointer at the list's top edge
    await handle(page, 'Owner').scrollIntoViewIfNeeded();
    const grip = await handle(page, 'Owner').boundingBox();
    const box = await list.boundingBox();
    const x = grip!.x + grip!.width / 2;
    await page.mouse.move(x, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, box!.y + 6, { steps: 10 });
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(80);
      await page.mouse.move(x, box!.y + 6 + (i % 2));
    }
    await expect
      .poll(async () => list.evaluate((el) => el.scrollTop), { message: 'the list scrolled to its top' })
      .toBe(0);
    await page.mouse.up();
    const after = await headers(page);
    expect(after.indexOf('owner')).toBeLessThan(before.indexOf('owner') - 3);
    await expect(menu(page)).toBeVisible();
  });

  test('releasing the pointer outside the popover still drops the column and keeps the menu open', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    const rows = menu(page).locator('[data-col-row]');
    const ids = await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.colRow!));
    const from = ids.indexOf('time');
    const target = await rows.nth(from - 2).boundingBox();
    const grip = await handle(page, 'Date').boundingBox();
    const dialog = await menu(page).boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    // drift left out of the popover while moving up two rows, then release there
    await page.mouse.move(dialog!.x - 80, target!.y + 2, { steps: 12 });
    await page.mouse.up();
    const after = await headers(page);
    expect(after.indexOf('time')).toBe(before.indexOf('time') - 2);
    await expect(menu(page)).toBeVisible();
  });

  test('a drag held at the bottom edge scrolls the list, so a column from the top reaches the end', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    const list = menu(page).getByRole('list', { name: 'Column order' });
    const rows = menu(page).locator('[data-col-row]');
    const ids = await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.colRow!));
    const grip = await handle(page, 'Task').boundingBox();
    const box = await list.boundingBox();
    const x = grip!.x + grip!.width / 2;
    await page.mouse.move(x, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, box!.y + box!.height - 6, { steps: 10 });
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(80);
      await page.mouse.move(x, box!.y + box!.height - 6 - (i % 2));
    }
    await expect
      .poll(
        async () => list.evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1),
        { message: 'the list scrolled to its end' },
      )
      .toBe(true);
    await page.mouse.up();
    const after = await headers(page);
    expect(after.length).toBe(before.length);
    // Task is now the last of the reorderable columns (the locked actions column stays after it)
    expect(after.filter((c) => ids.includes(c)).at(-1)).toBe('task');
    expect(after.indexOf('task')).toBeGreaterThan(before.indexOf('task') + 8);
    await expect(menu(page)).toBeVisible();
  });

  test('a pointer drag downward by three rows moves the column down by three', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const before = await headers(page);
    await openMenu(page);
    const rows = menu(page).locator('[data-col-row]');
    const ids = await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.colRow!));
    const from = ids.indexOf('task');
    const target = await rows.nth(from + 3).boundingBox();
    const grip = await handle(page, 'Task').boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x + grip!.width / 2, target!.y + target!.height - 2, { steps: 12 });
    await page.mouse.up();
    const after = await headers(page);
    expect(after.indexOf('task')).toBe(before.indexOf('task') + 3);
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
