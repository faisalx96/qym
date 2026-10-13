/// <reference lib="dom" />
/**
 * Cutover: ported from tests/platform/test_review_workflow_browser.py (trash
 * purge countdown). The countdown arithmetic itself is covered by
 * src/features/trash/__tests__/purge.test.ts; here the page is checked against
 * a fixed list so the order, copy, flags and layout are deterministic.
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';

const DAY = 86_400_000;

function row(id: string, purgeInDays: number | null, extra: Record<string, unknown> = {}) {
  const deleted = Date.now() - 2 * DAY;
  return {
    id,
    run_name: id,
    task: 'task',
    dataset: 'dataset',
    dataset_version: null,
    dataset_aliases: null,
    model: 'model',
    trace_stats: null,
    status: 'COMPLETED',
    owner_user_id: null,
    deleted_at: new Date(deleted).toISOString(),
    deleted_by_user_id: null,
    deleted_by_name: 'Admin',
    created_at: new Date(deleted - DAY).toISOString(),
    purge_at: purgeInDays === null ? null : new Date(Date.now() + purgeInDays * DAY).toISOString(),
    purge_paused: false,
    project_archived: false,
    project_id: 'p1',
    project_name: 'Project',
    project_slug: 'project',
    ...extra,
  };
}

async function mockTrash(page: Page, rows: unknown[], graceDays: number) {
  await page.route('**/api/runs/trash?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'X-Qym-Total-Count': String(rows.length),
        'X-Qym-Deleted-Run-Grace-Days': String(graceDays),
      },
      body: JSON.stringify(rows),
    }),
  );
  await page.route('**/api/runs/trash/projects*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'p1', name: 'Project', slug: 'project', archived: false, deleted_runs: rows.length },
      ]),
    }),
  );
}

const dataRows = (page: Page) =>
  page.getByRole('grid', { name: 'Deleted runs' }).locator('[role=row]:has([role=gridcell])');

test.describe('trash purge countdown', () => {
  test('lists the soonest purge first and flags rows near purge', async ({ page }) => {
    // newest-deleted first, as the API returns them
    await mockTrash(
      page,
      [row('run-new', 28), row('run-two-days', 1.5), row('run-hours', 0.5), row('run-overdue', -1)],
      30,
    );
    await gotoApp(page, '/trash');
    await expect(dataRows(page)).toHaveCount(4);
    await expect(
      page.getByText(
        'Deleted runs are permanently removed 30 days after deletion, not counting time their project spends archived. Restore a run before its purge date to keep it.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Retention 30 days')).toBeVisible();
    const names = await dataRows(page).evaluateAll((rows) => rows.map((r) => r.textContent ?? ''));
    expect(
      names.map((t) =>
        ['run-overdue', 'run-hours', 'run-two-days', 'run-new'].findIndex((id) => t.startsWith(id)),
      ),
    ).toEqual([0, 1, 2, 3]);
    const purges = await dataRows(page).evaluateAll((rows) =>
      rows.map((r) => r.querySelector('[data-col="purges"]')?.textContent ?? ''),
    );
    expect(purges.map((t) => t.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}.*$/, '').trim())).toEqual([
      'Due now',
      'in under 1 day',
      'in 2 days',
      'in 28 days',
    ]);
    const soon = await dataRows(page).evaluateAll((rows) =>
      rows.map((r) => r.querySelector('[data-soon]') !== null),
    );
    expect(soon).toEqual([true, true, true, false]);
  });

  test('says so when automatic purge is off', async ({ page }) => {
    await mockTrash(page, [row('run-kept', null)], 0);
    await gotoApp(page, '/trash');
    await expect(dataRows(page)).toHaveCount(1);
    await expect(
      page.getByText('Automatic purge is off: deleted runs are kept until removed by an operator.'),
    ).toBeVisible();
    await expect(page.getByText('Retention Off')).toBeVisible();
    await expect(dataRows(page).first()).toContainText('Not scheduled');
    await expect(page.locator('[data-soon]')).toHaveCount(0);
  });

  test('the Purges column keeps Restore in view on a laptop screen', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const long = [
      ['chunk_512_overlap_64_hybrid_bm25', 'openai/gpt-4o'],
      ['qwen2.5-72b_insightor_arabic_subset', 'openai/gpt-4.1-mini'],
      ['hotfix_verify_tokenizer_whitespace_bug', 'anthropic/claude-sonnet-5'],
    ].map(([name, model], i) =>
      row(`showcase-0${i}`, 2 + i, {
        run_name: name,
        model,
        task: 'text2sql',
        dataset: 'text2sql-chart-showcase-v1',
        deleted_by_name: 'Faisal',
      }),
    );
    await mockTrash(page, long, 30);
    await gotoApp(page, '/trash');
    await expect(dataRows(page)).toHaveCount(3);
    const buttons = page.getByRole('button', { name: 'Restore', exact: true });
    await expect(buttons).toHaveCount(3);
    // The table may scroll sideways, but the sticky Restore column stays inside the visible part of it.
    const report = await page.evaluate(() => {
      const grid = document.querySelector('[role=grid]') as HTMLElement;
      let scroller: HTMLElement | null = grid;
      while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX))
        scroller = scroller.parentElement;
      const box = (scroller ?? grid).getBoundingClientRect();
      const buttons = Array.from(grid.querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === 'Restore',
      );
      return {
        buttons: buttons.length,
        clipped: buttons.filter(
          (b) => b.getBoundingClientRect().right > box.right + 1 || b.getBoundingClientRect().left < box.left,
        ).length,
        scrolls: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      };
    });
    expect(report).toMatchObject({ buttons: 3, clipped: 0 });
    for (let i = 0; i < 3; i++) await expect(buttons.nth(i)).toBeInViewport();
  });
});
