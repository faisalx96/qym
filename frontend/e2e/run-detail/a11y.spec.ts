/**
 * axe-core on the run page. Only CRITICAL violations inside run-detail markup fail the test;
 * SERIOUS ones are reported as test annotations (and printed) for triage.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  openRootCause,
  openRun,
  seedClassic,
  seedProject,
  seedRepeat,
  type Seeded,
} from './support';

let s: Seeded;
let classic: string;
let repeat: string;

test.beforeAll(async () => {
  s = await seedProject('rd-axe');
  classic = await seedClassic(s);
  repeat = await seedRepeat(s);
});

async function audit(page: Page, label: string, context: string): Promise<void> {
  const violations = await axeSeriousViolations(page, context);
  const serious = violations.filter((v) => v.impact === 'serious');
  const critical = violations.filter((v) => v.impact === 'critical');
  if (serious.length) {
    const text = describeViolations(serious);
    test.info().annotations.push({ type: `axe serious: ${label}`, description: text.slice(0, 3000) });
    console.log(`[axe serious] ${label}\n${text}`);
  }
  expect(critical, `${label}\n${describeViolations(critical)}`).toEqual([]);
}

test.describe('axe', () => {
  test('default run page (table, filter bar, report sections)', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(page.locator('[data-testid=metric-card]').first()).toBeVisible();
    await audit(page, 'default page', '#shell-content');
  });

  test('report sections: errors, categories, latency, deep', async ({ page }) => {
    for (const panel of ['errors', 'categories', 'latency', 'deep']) {
      await openRun(page, s.slug, classic, `panel=${panel}`);
      await expect(page.locator(`#run-section-${panel}`)).toBeInViewport();
      await audit(page, `panel ${panel}`, '#shell-content');
    }
  });

  test('an opened item with metric strip and root-cause card', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0003');
    await expect(page.locator('[data-testid=item-card][data-item-id="item-0003"]')).toBeVisible();
    await audit(page, 'opened item', '#shell-content');
  });

  test('filter rules popover', async ({ page }) => {
    await openRun(
      page,
      s.slug,
      classic,
      'filters=' +
        encodeURIComponent(
          JSON.stringify({
            rules: { op: 'and', children: [{ field: 'latency', oper: 'gt', value: '1000' }] },
          }),
        ),
    );
    await page.getByTestId('open-filters').click();
    await expect(page.getByRole('dialog', { name: 'Filter rules' })).toBeVisible();
    await audit(page, 'rule builder', '[role=dialog]');
  });

  test('open trace drawer', async ({ page }) => {
    await openRun(page, s.slug, classic, 'trace=item-0004');
    await expect(page.getByTestId('trace-drawer')).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Span tree' })).toBeVisible();
    await audit(page, 'trace drawer', '[role=dialog]');
  });

  test('retried trace with attempts', async ({ page }) => {
    await openRun(page, s.slug, classic, 'trace=item-0006');
    await expect(page.getByRole('group', { name: 'Attempts' })).toBeVisible();
    await audit(page, 'retried trace drawer', '[role=dialog]');
  });

  test('issue dialog', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0003');
    const card = page.locator('[data-testid=item-card][data-item-id="item-0003"]');
    await openRootCause(card);
    await card.getByRole('button', { name: '+ Add issue' }).first().click();
    await expect(page.getByTestId('issue-dialog')).toBeVisible();
    await audit(page, 'issue dialog', '[role=dialog]');
  });

  test('repeat run: Repeat tab and heatmap', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'panel=repeat');
    await expect(page.getByTestId('repeat-analysis')).toBeVisible();
    await audit(page, 'repeat tab', '#shell-content');
    await openRun(page, s.slug, repeat, 'view=heatmap');
    await expect(page.getByRole('grid', { name: /by item and pass/ })).toBeVisible();
    await audit(page, 'heatmap', '#shell-content');
  });
});
