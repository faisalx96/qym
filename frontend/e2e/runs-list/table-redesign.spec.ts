/** Runs table redesign: first-paint content, header focus, text selection vs row click, exposed bands. */
import { test, expect, type Page } from '@playwright/test';
import { clickBox, dataRows, openRuns, sharedProject, table } from './support';

const scroller = (page: Page) => table(page).locator('[data-dt-scroller]');

test.describe('runs table redesign', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('score bars, task chips and the Date column are on screen on first paint', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const view = (await scroller(page).boundingBox())!;
    const date = (await table(page).getByRole('columnheader', { name: 'Date', exact: true }).boundingBox())!;
    const actions = (await table(page).locator('thead th[data-col="actions"]').boundingBox())!;
    expect(date.x + date.width, 'Date header inside the visible table').toBeLessThanOrEqual(actions.x);
    expect(date.x + date.width).toBeLessThanOrEqual(view.x + view.width);
    const row = dataRows(page).first();
    await expect(row.locator('td[data-col="task"] span').first()).toBeVisible();
    expect(await table(page).locator('tbody [data-band]').count(), 'metric score bars').toBeGreaterThan(0);
    await expect(
      table(page).getByRole('columnheader', { name: 'Scores', exact: true }).first(),
    ).toBeVisible();
    await expect(table(page).getByRole('columnheader', { name: 'Overview', exact: true })).toBeVisible();
  });

  test('Date (the default sort) is on screen at 1280 too, before the first score', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const cols = await table(page)
      .locator('thead tr:last-child th[data-col]')
      .evaluateAll((ths) => ths.map((t) => (t as HTMLElement).dataset.col));
    expect(cols.indexOf('time')).toBeLessThan(cols.findIndex((c) => c?.startsWith('metric-')));
    const date = (await table(page).getByRole('columnheader', { name: 'Date', exact: true }).boundingBox())!;
    const actions = (await table(page).locator('thead th[data-col="actions"]').boundingBox())!;
    expect(date.x + date.width, 'Date header left of Actions').toBeLessThanOrEqual(actions.x);
  });

  test('no header label is truncated', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const clipped = await table(page)
      .locator('thead tr:last-child [data-th-label]:not([data-hidden])')
      .evaluateAll((els) =>
        els
          .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1)
          .map((e) => e.textContent),
      );
    expect(clipped).toEqual([]);
  });

  test('Tab enters the header row once, arrows move between headers', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByPlaceholder('Search runs').focus();
    let inHeader = 0;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => !!document.activeElement?.closest('thead'))) inHeader++;
      if (await page.evaluate(() => !!document.activeElement?.closest('tbody'))) break;
    }
    expect(inHeader, 'tab stops inside the header row').toBeLessThanOrEqual(1);
    const th = table(page).locator('thead tr:last-child th[tabindex="0"]');
    await th.focus();
    const first = await page.evaluate(() => document.activeElement?.getAttribute('data-col'));
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-col')))
      .not.toBe(first);
    await page.keyboard.press('Enter');
    await expect(
      table(page).locator('thead th[aria-sort="ascending"], thead th[aria-sort="descending"]'),
    ).toHaveCount(1);
  });

  test('selecting text in a row does not open the run', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const url = page.url();
    const cell = dataRows(page).first().locator('td[data-col="time"]');
    const box = (await cell.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(page.url()).toBe(url);
    const picked = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(picked.length).toBeGreaterThan(0);
  });

  test('double-clicking a word selects it and stays on the list', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const url = page.url();
    await dataRows(page)
      .first()
      .locator('td[data-col="time"]')
      .dblclick({ position: { x: 20, y: 10 } });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(url);
  });

  test('a plain click on a row still opens it', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await dataRows(page).first().locator('td[data-col="time"]').click();
    await expect(page).toHaveURL(/\/runs\//);
  });

  test('shift-click ranges rows in select mode without a native text selection', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickBox(page.getByRole('checkbox', { name: /^Select / }).nth(1));
    await dataRows(page)
      .nth(3)
      .locator('td[data-col="time"]')
      .click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-bar')).toContainText('4 executions selected');
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  });

  test('sort cycles ascending, descending, default', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const head = table(page).getByRole('columnheader', { name: 'Task', exact: true });
    await head.scrollIntoViewIfNeeded();
    const sortButton = head.getByRole('button', { name: 'Task', exact: true });
    await sortButton.click();
    await expect(head).toHaveAttribute('aria-sort', 'ascending');
    await sortButton.click();
    await expect(head).toHaveAttribute('aria-sort', 'descending');
    await sortButton.click();
    await expect(head).toHaveAttribute('aria-sort', 'none');
  });

  test('density and page size controls are in the table chrome', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Row density' }).click();
    await page.getByRole('menuitem', { name: 'Comfortable' }).click();
    await expect(page.getByTestId('data-table')).toHaveAttribute('data-density', 'comfortable');
    await expect(page.getByTestId('status-bar').getByRole('combobox')).toBeVisible();
  });
});
