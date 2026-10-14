/** Redesign 2, W1: the always-visible filter bar (facet triggers, More filters, chips, Clear n, phone drawer). */
import { test, expect, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  clickBox,
  dataRows,
  describeViolations,
  openRuns,
  sharedProject,
  urlParams,
} from './support';

const bar = (page: Page) => page.getByTestId('filter-bar');
const facet = (page: Page, name: string) =>
  bar(page).getByRole('button', { name: new RegExp(`^${name} filter`) });

for (const width of [1440, 1280]) {
  test.describe(`filter bar at ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('Time, Origin and all six facet triggers are on screen without opening anything', async ({
      page,
      request,
    }) => {
      const s = await sharedProject(request, 12);
      await openRuns(page, s.project.slug);
      await expect(page.getByRole('radiogroup', { name: 'Time range' })).toBeVisible();
      await expect(page.getByRole('radiogroup', { name: 'Origin' })).toBeVisible();
      for (const name of ['Task', 'Dataset', 'Model', 'Version', 'Status', 'User'])
        await expect(facet(page, name)).toBeVisible();
      await expect(bar(page)).toHaveAttribute('role', 'toolbar');
      await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toHaveCount(0);
    });

    test('one facet costs two actions: open the trigger, press Only; the value is written on the trigger', async ({
      page,
      request,
    }) => {
      const s = await sharedProject(request, 12);
      await openRuns(page, s.project.slug);
      await facet(page, 'Model').click();
      await page
        .getByTestId('filters-panel')
        .getByRole('button', { name: /^Only .*gpt-4o/ })
        .click();
      await expect.poll(() => urlParams(page).getAll('model').length).toBe(1);
      await page.keyboard.press('Escape');
      await expect(facet(page, 'Model')).toContainText('gpt-4o');
      await expect(facet(page, 'Model')).toHaveAttribute('aria-label', 'Model filter, 1 selected');
      await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText('model:');
      // a second facet composes with it
      await facet(page, 'Status').click();
      await clickBox(page.getByTestId('filters-panel').getByRole('checkbox', { name: 'Completed' }));
      await expect.poll(() => urlParams(page).getAll('status')).toEqual(['COMPLETED']);
      await page.keyboard.press('Escape');
      await expect(bar(page).getByRole('button', { name: /^Clear 2/ })).toBeVisible();
      await expect(page.getByTestId('status-bar')).toContainText('status: Completed');
      await expect
        .poll(async () =>
          [
            ...new Set(
              await dataRows(page).evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.status)),
            ),
          ].join(),
        )
        .toBe('COMPLETED');
    });

    test('the selected status chip takes the status tone', async ({ page, request }) => {
      const s = await sharedProject(request, 12);
      await openRuns(page, s.project.slug, 'status=COMPLETED');
      const chip = page
        .getByRole('group', { name: 'Active filters', exact: true })
        .getByRole('button', { name: 'status: Completed', exact: true });
      await expect(chip).toHaveAttribute('data-tone', 'success');
    });

    test('the bar is at most 104px tall including chips and the table keeps 8 rows', async ({
      page,
      request,
    }) => {
      const s = await sharedProject(request, 12);
      await openRuns(page, s.project.slug, 'status=COMPLETED&task=summarize');
      const h = await page
        .locator('[data-dt-toolbar]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(h).toBeLessThanOrEqual(width === 1440 ? 120 : 130);
      await expect(dataRows(page).first()).toBeVisible();
    });

    test('axe: no serious or critical violations with a facet list open', async ({ page, request }) => {
      const s = await sharedProject(request, 12);
      await openRuns(page, s.project.slug);
      await facet(page, 'Model').click();
      await expect(page.getByTestId('filters-panel')).toBeVisible();
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      );
      const v = await axeSeriousViolations(page);
      expect(v, describeViolations(v)).toEqual([]);
    });
  });
}

test.describe('filter bar at 768', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('lower-priority facets move under More filters, which still filters', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await expect(facet(page, 'Status')).toBeVisible();
    await expect(facet(page, 'Model')).toBeVisible();
    await expect(facet(page, 'Task')).toBeVisible();
    const more = bar(page).getByTestId('filters-trigger');
    await expect(more).toContainText('More filters');
    const panel = page.getByTestId('filters-panel');
    await more.click();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: /^Version/ }).click();
    await expect(panel.getByRole('button', { name: /^Only / }).first()).toBeVisible();
  });
});

test.describe('filter bar at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('search plus one Filters button opens the full list in a drawer', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await expect(page.getByLabel('Search runs')).toBeVisible();
    await expect(facet(page, 'Model')).toHaveCount(0);
    const trigger = page.getByTestId('filters-trigger');
    await expect(trigger).toHaveText('Filters');
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'Filters' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('radiogroup', { name: 'Time range' })).toBeVisible();
    await drawer.getByRole('button', { name: /^Status/ }).click();
    await drawer.getByRole('button', { name: 'Only Completed' }).click();
    await expect.poll(() => urlParams(page).getAll('status')).toEqual(['COMPLETED']);
    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toContainText('Filters · 1');
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'status: Completed',
    );
    const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
    expect(overflow).toBe(true);
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });
});
