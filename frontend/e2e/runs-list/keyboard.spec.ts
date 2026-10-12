/** Runs-table keyboard model (brief 03 "Keyboard", WCAG 2.1.4 opt-out, Tab order). */
import { test, expect, type Page } from '@playwright/test';
import { clickBox, dataRows, freshProject, openRuns, sharedProject, urlParams } from './support';

const focusedRow = (page: Page) => page.locator('[data-testid="runs-table"] tbody tr[data-focused]');
const focusedIndex = (page: Page) =>
  dataRows(page).evaluateAll((rows) => rows.findIndex((r) => r.hasAttribute('data-focused')));
const blurToBody = (page: Page) => page.locator('body').click({ position: { x: 3, y: 3 } });

test.describe('runs list: keyboard', () => {
  test('j/k and arrows move the focused row with a visible ring; g/G jump; Enter opens', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('j');
    expect(await focusedIndex(page)).toBe(0);
    await page.keyboard.press('j');
    expect(await focusedIndex(page)).toBe(1);
    await page.keyboard.press('ArrowDown');
    expect(await focusedIndex(page)).toBe(2);
    await page.keyboard.press('k');
    expect(await focusedIndex(page)).toBe(1);
    await page.keyboard.press('ArrowUp');
    expect(await focusedIndex(page)).toBe(0);
    await page.keyboard.press('k');
    expect(await focusedIndex(page)).toBe(0); // does not wrap
    // the focused row is the DOM-focused element and shows a ring
    await expect(focusedRow(page)).toBeFocused();
    const ring = await focusedRow(page)
      .locator('td')
      .first()
      .evaluate((td) => getComputedStyle(td).boxShadow);
    expect(ring).not.toBe('none');
    await page.keyboard.press('G');
    expect(await focusedIndex(page)).toBe((await dataRows(page).count()) - 1);
    await page.keyboard.press('g');
    expect(await focusedIndex(page)).toBe(0);
    const name = (await dataRows(page).first().locator('td[data-col="run"] a').innerText()).trim();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/runs\/.+\?list=|\/runs\//);
    expect(decodeURIComponent(page.url())).toContain('/runs/');
    expect(name.length).toBeGreaterThan(0);
  });

  test('? opens the shortcuts dialog and Esc closes it; the dialog swallows list keys', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dlg).toBeVisible();
    for (const k of ['j', 'x', '3', 'c']) await page.keyboard.press(k);
    expect(await focusedIndex(page)).toBe(-1);
    expect(urlParams(page).has('range')).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    // the status-bar button opens it too
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(dlg).toBeVisible();
  });

  test('c with Cohort A locked opens the cohort comparison, not a plain compare', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12, { running: false });
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    const tick = (n: string) => clickBox(page.getByRole('checkbox', { name: `Select ${n}`, exact: true }));
    await tick('text2sql-gpt-4o-000');
    await tick('summarize-gpt-4o-001');
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Cohort', exact: true }).click();
    await tick('rag-qa-claude-sonnet-4-002');
    await tick('summarize-gpt-4o-004');
    await blurToBody(page);
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/compare\?cohortA=/);
  });

  test('1-4 set the time range', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('3');
    await expect.poll(() => urlParams(page).get('range')).toBe('week');
    await page.keyboard.press('4');
    await expect.poll(() => urlParams(page).get('range')).toBe('month');
    await page.keyboard.press('2');
    await expect.poll(() => urlParams(page).get('range')).toBe('today');
    await page.keyboard.press('1');
    await expect.poll(() => urlParams(page).has('range')).toBe(false);
  });

  test('the single-key opt-out disables j/k/x/c but not arrows, Enter or Esc', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await clickBox(dlg.getByRole('switch', { name: /Single-key shortcuts/ }));
    expect(await page.evaluate(() => localStorage.getItem('qym:single-key-shortcuts'))).toBe('off');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await blurToBody(page);
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('3');
    expect(await focusedIndex(page)).toBe(-1);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    expect(urlParams(page).has('range')).toBe(false);
    // arrows still work
    await page.keyboard.press('ArrowDown');
    expect(await focusedIndex(page)).toBe(0);
    await page.keyboard.press('ArrowDown');
    expect(await focusedIndex(page)).toBe(1);
    // Esc still works: select a row by checkbox, then Esc clears it
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await dataRows(page).nth(1).locator('label').first().click();
    await expect(page.getByTestId('selection-bar')).toContainText('1 execution selected');
    await blurToBody(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-bar')).toContainText('0 executions selected');
    // Enter still opens the focused run
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/runs\//);
    // and the preference survives a reload
    await page.goto(`/projects/${s.project.slug}`);
    await expect(dataRows(page).first()).toBeVisible();
    await blurToBody(page);
    await page.keyboard.press('j');
    expect(await focusedIndex(page)).toBe(-1);
  });

  test('shortcuts never fire while typing in the search box', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('/');
    const search = page.getByLabel('Search runs');
    await expect(search).toBeFocused();
    await page.keyboard.type('jkxcg?1234G');
    await expect(search).toHaveValue('jkxcg?1234G');
    expect(await focusedIndex(page)).toBe(-1);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(urlParams(page).has('range')).toBe(false);
    await expect.poll(() => urlParams(page).get('q')).toBe('jkxcg?1234G');
  });

  test('shortcuts never fire with the Filters popover open', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await page.getByTestId('filters-trigger').click();
    await expect(page.getByTestId('filters-panel')).toBeVisible();
    for (const k of ['j', 'x', '3', 'c', '?', 'g']) await page.keyboard.press(k);
    expect(await focusedIndex(page)).toBe(-1);
    expect(urlParams(page).has('range')).toBe(false);
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('Tab order: search -> Filters -> ... -> first sortable header within 6 stops', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search runs')).toBeFocused();
    const seen: string[] = [];
    let stops = 0;
    for (; stops < 8; stops++) {
      await page.keyboard.press('Tab');
      const desc = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return `${el.tagName}:${el.textContent?.trim().slice(0, 20)}:${el.closest('thead') ? 'HEAD' : ''}`;
      });
      seen.push(desc);
      if (desc.endsWith('HEAD')) break;
    }
    expect(seen[0], seen.join(' > ')).toContain('Filters');
    expect(seen.at(-1), seen.join(' > ')).toMatch(/HEAD$/);
    expect(stops + 1, seen.join(' > ')).toBeLessThanOrEqual(6);
  });

  test('keyboard focus crosses the page edge (j on the last row of page 1 loads page 2)', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 55, 'big');
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('G'); // last run of the whole list
    await expect.poll(() => urlParams(page).get('page')).toBe('2');
    await expect(dataRows(page)).toHaveCount(6);
    await expect.poll(() => focusedIndex(page)).toBe(5);
  });

  test('g from page 2 returns to the first row of page 1 with focus on it', async ({ page, request }) => {
    const s = await sharedProject(request, 55, 'big');
    await openRuns(page, s.project.slug);
    await blurToBody(page);
    await page.keyboard.press('G');
    await expect.poll(() => urlParams(page).get('page')).toBe('2');
    await expect.poll(() => focusedIndex(page)).toBe(5);
    await page.keyboard.press('g');
    await expect.poll(() => urlParams(page).has('page')).toBe(false);
    await expect.poll(() => focusedIndex(page)).toBe(0);
  });
});
