/**
 * Pinned columns of the Runs table (cutover of test_runs_frozen_columns_browser.py).
 * The React table pins the Run column and the Actions column with CSS `sticky` only
 * (decision §9.4: the choosable "Frozen columns" section was dropped). What stays
 * protected: pinned controls remain reachable, and no keyboard stop hides under them.
 */
import { test, expect, type Page } from '@playwright/test';
import { dataRows, openRuns, sharedProject } from './support';

const scroller = (page: Page) => page.getByTestId('runs-table').locator('[data-dt-scroller]');

/** True when the centre of `selector`'s first match is hit by itself (not covered by a pinned cell). */
async function reachable(page: Page, handle: ReturnType<Page['locator']>): Promise<boolean> {
  return handle.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  });
}

test.describe('runs list: pinned columns', () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test('the table scrolls sideways and the Run and Actions columns stay pinned at its end', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const geometry = await scroller(page).evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth + 50,
    }));
    expect(geometry.scrollable).toBe(true);
    await scroller(page).evaluate((el) => (el.scrollLeft = el.scrollWidth));
    const row = dataRows(page).first();
    const run = row.locator('td[data-col="run"]');
    const actions = row.locator('td[data-col="actions"]');
    const view = (await scroller(page).boundingBox())!;
    const runBox = (await run.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    expect(Math.abs(runBox.x - view.x)).toBeLessThan(2);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(view.x + view.width + 1);
    expect(actionsBox.x + actionsBox.width).toBeGreaterThan(view.x + view.width - 30);
    // The pinned controls answer a click: nothing covers them.
    expect(await reachable(page, run.locator('a').first())).toBe(true);
    const buttons = actions.getByRole('button');
    expect(await buttons.count()).toBeGreaterThan(0);
    expect(await reachable(page, buttons.first())).toBe(true);
  });

  test('Tab stops through a row are never hidden under a pinned column', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await scroller(page).evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await dataRows(page).first().locator('td[data-col="run"] a').first().focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const inTable = await page.evaluate(
        () =>
          !!document.activeElement && !!document.activeElement.closest('[data-testid="runs-table"] tbody'),
      );
      if (!inTable) break;
      const focused = page.locator(':focus');
      seen.push(
        (await focused.getAttribute('aria-label')) ?? (await focused.innerText()).trim().slice(0, 20),
      );
      expect(await reachable(page, focused), `stop ${i} (${seen[i]}) is covered`).toBe(true);
      await page.keyboard.press('Tab');
    }
    expect(seen.length).toBeGreaterThan(1);
  });
});
