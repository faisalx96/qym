/// <reference lib="dom" />
/**
 * Round 5 R3, as it lives in the item pane: the Metrics table of an item and the details of a metric (what its scorer
 * recorded beside the reason). Run `details`, item r5-005 (English `rubric_judge`, Arabic `arabic_judge`), at 1440 and
 * 390.
 *
 * The round 5 metric matrix and the detail panel that a clicked score opened are gone (MetricMatrix, MetricStrip). The
 * criteria that measured them in pixels (R3-1 header height, R3-2/4/5/6 label and prose geometry, R3-9 and R3-9b table
 * row heights and paddings, R3-13 type roles, R3-14 panel height, R3-16/17/18 matrix rows, R3-21 FieldRow labels, R3-7
 * output key rows) were deleted with them. The criteria below still apply to the pane.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  itemPane,
  metricRow,
  openMetric,
  openRun,
  seedProject,
  seedR5,
  type Seeded,
} from './support';

let s: Seeded;
let details: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r5-panel');
  details = (await seedR5(s)).details;
});

/** Open item r5-005 in the pane (by its link), with the metric details closed (the default). */
async function openItemPane(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 1000 });
  await openRun(page, s.slug, details, 'item=r5-005');
  const pane = itemPane(page, 'r5-005');
  await expect(pane).toBeVisible();
  await expect(metricRow(pane, 'rubric_judge')).toBeVisible();
  return pane;
}

/** Sideways overflow of the pane body (its scroller) and of the page. */
async function sideways(pane: Locator): Promise<{ pane: number; page: number }> {
  return pane.evaluate((el) => {
    const body = el.lastElementChild as HTMLElement;
    return {
      pane: body.scrollWidth - body.clientWidth,
      page: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

for (const width of [1440, 390] as const) {
  test.describe(`${width}px`, () => {
    test('R3-1, R3-20: the metric row has its name and score; the details are closed until the reader opens them; no sideways scroll', async ({
      page,
    }) => {
      const pane = await openItemPane(page, width);
      const row = metricRow(pane, 'rubric_judge');
      await expect(row).toContainText('rubric_judge');
      await expect(row).toContainText('%');
      await expect(pane.locator('[data-part="metric-details"]')).toHaveCount(0);
      const show = row.getByRole('button', { name: 'Show the details of rubric_judge', exact: true });
      await expect(show).toHaveAttribute('aria-expanded', 'false');
      const panel = await openMetric(pane, 'rubric_judge');
      await expect(panel.getByRole('group', { name: 'Details of rubric_judge' })).toBeVisible();
      // one metric only: the other metrics stay closed
      await expect(pane.locator('[data-part="metric-details"]')).toHaveCount(1);
      const o = await sideways(pane);
      expect(o.pane).toBeLessThanOrEqual(0);
      expect(o.page).toBeLessThanOrEqual(0);
      await row.getByRole('button', { name: 'Hide the details of rubric_judge', exact: true }).click();
      await expect(pane.locator('[data-part="metric-details"]')).toHaveCount(0);
    });

    test('R3-15: the Edit tile opens the score editor in the row; Escape closes it, keeps the pane and gives the focus back', async ({
      page,
    }) => {
      const pane = await openItemPane(page, width);
      const row = metricRow(pane, 'rubric_judge');
      const edit = row.getByRole('button', { name: 'Edit the rubric_judge score', exact: true });
      await edit.click();
      await expect(row).toHaveAttribute('data-editing', '');
      await expect(row.getByRole('form', { name: 'Edit rubric_judge score' })).toBeVisible();
      await row.getByRole('textbox', { name: 'New rubric_judge score' }).press('Escape');
      await expect(row.getByRole('textbox')).toHaveCount(0);
      await expect(pane).toBeVisible();
      await expect(edit).toBeFocused();
    });

    test('Expand all opens the details of every metric and the choice is remembered', async ({ page }) => {
      const pane = await openItemPane(page, width);
      const section = pane.locator('[data-part="metrics-section"]');
      await section.getByRole('button', { name: 'Expand all', exact: true }).click();
      await expect(section.getByRole('button', { name: 'Collapse all', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(pane.getByRole('group', { name: 'Details of rubric_judge' })).toBeVisible();
      await expect(pane.getByRole('group', { name: 'Details of arabic_judge' })).toBeVisible();
      // the preference is one for every pane (localStorage)
      expect(await page.evaluate(() => window.localStorage.getItem('qym:item-pane:details'))).toBe('open');
      await page.reload();
      await expect(pane.getByRole('group', { name: 'Details of rubric_judge' })).toBeVisible();
    });

    test('R3-3 (round 7, D2): every key of the details is whole in its column, with no ellipsis', async ({
      page,
    }) => {
      const pane = await openItemPane(page, width);
      const panel = await openMetric(pane, 'rubric_judge');
      const keys = await panel.locator('[data-part="key"]').evaluateAll((els) =>
        els.map((k) => ({
          key: k.textContent ?? '',
          overflow: k.scrollWidth - k.clientWidth,
          ellipsis: getComputedStyle(k).textOverflow,
        })),
      );
      // the reason text (`reasoning`) is in the Reason column of the row, not in the details
      const names = keys.map((k) => k.key);
      expect(names.some((k) => k.startsWith('self_consistency_check_result'))).toBe(true);
      expect(names.some((k) => k.startsWith('detailed_reasoning_trace'))).toBe(true);
      expect(names.some((k) => k === 'reasoning')).toBe(false);
      for (const k of keys) {
        expect(k.overflow, k.key).toBeLessThanOrEqual(0);
        expect(k.ellipsis, k.key).not.toBe('ellipsis');
      }
    });

    test('R3-8, R3-11, R3-12: tables in the details, sorting, 12 rows then "Show 2 more", no sideways scroll of the pane', async ({
      page,
    }) => {
      const pane = await openItemPane(page, width);
      const panel = await openMetric(pane, 'rubric_judge');
      // a table is named by its key as written
      for (const t of ['score_table', 'criteria', 'evidence', 'log_table'])
        await expect(panel.getByRole('grid', { name: t, exact: true })).toBeVisible();
      // the short list and the nested group are fields of the details
      for (const k of ['breakdown', 'flags'])
        await expect(panel.locator('[data-part="key"]', { hasText: k }).first()).toBeVisible();
      const grid = panel.getByRole('grid', { name: 'evidence', exact: true });
      const bodyRows = grid.locator('[role=row]:has([role=gridcell])');
      await expect(bodyRows).toHaveCount(3);
      // sorting: a click on the column title puts the rows in order
      // the first column is the row header (17 Nov D3: the identity column of a table)
      const firstCell = () =>
        bodyRows.first().locator('[role=rowheader], [role=gridcell]').first().textContent();
      expect(await firstCell()).toContain('policy-handbook.pdf');
      const head = grid.getByRole('columnheader', { name: /doc/ });
      await expect(head).toHaveAttribute('aria-sort', /none|ascending|descending/);
      await head.click();
      await expect(head).toHaveAttribute('aria-sort', /ascending|descending/);
      const dir = await head.getAttribute('aria-sort');
      expect(await firstCell()).toContain(dir === 'ascending' ? 'faq.md' : 'policy-handbook.pdf');
      // R3-12: a long table shows its first 12 rows and a button for the rest
      const log = panel.getByRole('grid', { name: 'log_table', exact: true });
      await expect(log.locator('[role=row]:has([role=gridcell])')).toHaveCount(12);
      await panel.getByRole('button', { name: 'Show 2 more' }).click();
      await expect(log.locator('[role=row]:has([role=gridcell])')).toHaveCount(14);
      // R3-10: the pane never scrolls sideways (a wide table scrolls in its own box)
      expect((await sideways(pane)).pane).toBeLessThanOrEqual(0);
    });

    test('R3-6: Arabic details read right-to-left', async ({ page }) => {
      const pane = await openItemPane(page, width);
      // the Arabic reason is in the Reason column of the row
      await expect(metricRow(pane, 'arabic_judge').locator('[dir="rtl"]').first()).toBeVisible();
      const panel = await openMetric(pane, 'arabic_judge');
      await expect(
        panel.locator('[data-part="key"]', { hasText: 'step_by_step_reasoning_notes' }),
      ).toBeVisible();
      await expect(panel.locator('[dir="rtl"]').first()).toBeVisible();
      await expect(panel.getByRole('grid', { name: 'checks', exact: true })).toBeVisible();
    });

    test('R3-22: axe finds no serious or critical violation with the details open (English and Arabic)', async ({
      page,
    }) => {
      const pane = await openItemPane(page, width);
      for (const metric of ['rubric_judge', 'arabic_judge']) {
        await openMetric(pane, metric);
        const v = (
          await axeSeriousViolations(page, '[data-testid=item-pane] [data-part=metric-details]')
        ).filter((x) => x.impact === 'serious' || x.impact === 'critical');
        expect(v, `${metric}\n${describeViolations(v)}`).toEqual([]);
      }
    });
  });
}
