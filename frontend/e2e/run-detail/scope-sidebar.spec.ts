/** Scope bar and quick-filter sidebar: appears only while the item set is narrowed; drawer on narrow screens. */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  itemsCount,
  openRun,
  params,
  seedClassic,
  seedProject,
  type Seeded,
} from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-scope');
  classic = await seedClassic(s);
});

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Quick filters' });
const scopeBar = (page: Page) => page.getByTestId('scope-bar');

/** Serious and critical axe violations both fail. */
async function audit(page: Page, label: string, context: string): Promise<void> {
  const violations = await axeSeriousViolations(page, context);
  expect(violations, `${label}\n${describeViolations(violations)}`).toEqual([]);
}

test.describe('desktop 1280', () => {
  test('no scope: no scope bar and no sidebar', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(scopeBar(page)).toHaveCount(0);
    await expect(sidebar(page)).toHaveCount(0);
  });

  test('a filter brings in the scope bar and the sidebar; Clear all removes both', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('radio', { name: 'Fail' }).click({ force: true });
    await expect(scopeBar(page)).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
    const [shown] = await itemsCount(page);
    await expect(scopeBar(page)).toContainText(`Scope: ${shown} of 240 items`);
    await expect(page.locator('#run-section-overview')).toContainText(`over ${shown} of 240 items`);
    await sidebar(page).getByRole('button', { name: 'Clear all' }).click();
    await expect(scopeBar(page)).toHaveCount(0);
    await expect(sidebar(page)).toHaveCount(0);
    expect(await itemsCount(page)).toEqual([240, 240]);
  });

  test('sidebar controls write the one filter model (status, category)', async ({ page }) => {
    await openRun(page, s.slug, classic, 'show=failed');
    await expect(sidebar(page)).toBeVisible();
    await sidebar(page).getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Fail' }).click();
    await expect(sidebar(page)).toHaveCount(0);
    expect(params(page).get('show')).toBeNull();
    await openRun(page, s.slug, classic, 'q=item');
    const category = sidebar(page)
      .getByRole('group', { name: /^Category/ })
      .first();
    await category.getByRole('button').first().click();
    await expect(sidebar(page).getByRole('button', { name: /from scope/ })).toHaveCount(2);
  });

  test('removing the last chip closes the scope', async ({ page }) => {
    await openRun(page, s.slug, classic, 'show=failed');
    await sidebar(page)
      .getByRole('group', { name: 'Active filters' })
      .getByRole('button', { name: /from scope/ })
      .click();
    await expect(scopeBar(page)).toHaveCount(0);
  });

  test('Hide keeps the scope bar, survives reload, Show brings the sidebar back', async ({ page }) => {
    await openRun(page, s.slug, classic, 'show=failed');
    await sidebar(page).getByRole('button', { name: 'Hide quick filters' }).click();
    await expect(sidebar(page)).toHaveCount(0);
    await expect(scopeBar(page)).toBeVisible();
    await page.reload();
    await expect(scopeBar(page)).toBeVisible();
    await expect(sidebar(page)).toHaveCount(0);
    await scopeBar(page).getByRole('button', { name: 'Show filters' }).click();
    await expect(sidebar(page)).toBeVisible();
  });

  test('View N items jumps to the table without clearing the scope', async ({ page }) => {
    await openRun(page, s.slug, classic, 'show=failed');
    await scopeBar(page)
      .getByRole('button', { name: /^View \d+ items/ })
      .click();
    await expect(page.getByRole('table', { name: 'Items' })).toBeInViewport();
    await expect(scopeBar(page)).toBeVisible();
  });

  test('with the sidebar the metric cards narrow to two per row; axe is clean', async ({ page }) => {
    await openRun(page, s.slug, classic, 'show=failed');
    const tops = await page
      .getByTestId('metric-card')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops.filter((t) => t === tops[0]).length).toBeLessThanOrEqual(2);
    await audit(page, 'scoped run page', '#shell-content');
  });
});

test.describe('narrow', () => {
  test('1000px: Quick filters opens a drawer; Escape returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openRun(page, s.slug, classic, 'show=failed');
    await expect(sidebar(page)).toHaveCount(0);
    const open = scopeBar(page).getByRole('button', { name: 'Quick filters' });
    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Quick filters' });
    await expect(drawer).toBeVisible();
    await audit(page, 'quick filters drawer', '[role=dialog]');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('390px: one column, no sideways scroll, scope bar and drawer work', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openRun(page, s.slug, classic, 'show=failed');
    await expect(scopeBar(page)).toBeVisible();
    const overflow = await page.evaluate(() => {
      const el = document.getElementById('shell-content')!;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await scopeBar(page).getByRole('button', { name: 'Quick filters' }).click();
    await expect(page.getByRole('dialog', { name: 'Quick filters' })).toBeVisible();
    await audit(page, 'drawer at 390', '[role=dialog]');
  });
});

test.describe('scope stays visible', () => {
  test('wide: the Active group lists the chips once (sidebar), the bar carries the count; Hide moves them to the bar', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic, 'show=failed');
    await expect(sidebar(page).getByRole('group', { name: 'Active filters' })).toBeVisible();
    await expect(page.getByRole('button', { name: /from scope/ })).toHaveCount(1);
    await expect(scopeBar(page).getByRole('button', { name: /from scope/ })).toHaveCount(0);
    // still visible after reading far down the report: the sidebar is sticky
    await page
      .getByRole('navigation', { name: 'Run sections' })
      .getByRole('link', { name: /^Errors/ })
      .click();
    await expect(sidebar(page).getByRole('group', { name: 'Active filters' })).toBeInViewport();
    await sidebar(page).getByRole('button', { name: 'Hide quick filters' }).click();
    await expect(scopeBar(page).getByRole('button', { name: /from scope/ })).toHaveCount(1);
  });

  test('1000px: the scope bar sticks under the nav while a lower section is read; the drawer has the Active group and one title', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openRun(page, s.slug, classic, 'show=failed');
    await page
      .getByRole('navigation', { name: 'Run sections' })
      .getByRole('link', { name: /^Errors/ })
      .click();
    await expect(scopeBar(page)).toBeInViewport();
    const nav = (await page.getByRole('navigation', { name: 'Run sections' }).boundingBox())!;
    await expect
      .poll(async () => Math.abs((await scopeBar(page).boundingBox())!.y - (nav.y + nav.height)))
      .toBeLessThan(6);
    await scopeBar(page).getByRole('button', { name: 'Quick filters' }).click();
    const drawer = page.getByRole('dialog', { name: 'Quick filters' });
    await expect(drawer.getByRole('group', { name: 'Active filters' })).toBeVisible();
    await expect(drawer.getByText('Quick filters', { exact: true })).toHaveCount(1);
  });

  test('390px: section descriptions wrap instead of ending in an ellipsis', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openRun(page, s.slug, classic);
    const clipped = await page
      .locator('#run-section-overview p')
      .first()
      .evaluate((p) => p.scrollWidth > p.clientWidth + 1);
    expect(clipped).toBe(false);
  });
});
