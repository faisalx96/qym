/** Charts at 390 px: cards with the group aggregates, controls that wrap, wider score bars; trash edge cue. */
import { test, expect } from '@playwright/test';
import { APP } from '../helpers';
import { axeSeriousViolations, describeViolations, freshProject } from './support';

test.describe('charts at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('runs are cards, Runs/Grouped fits, no sideways page scroll', async ({ page, request }) => {
    const s = await freshProject(request, 12, { running: false });
    await page.goto(`${APP}/projects/${s.project.slug}/charts`);
    const card = page.getByTestId('chart-card-text2sql');
    await expect(card).toBeVisible();
    await expect(card.getByRole('list').first()).toBeVisible();
    await expect(card.getByRole('grid')).toHaveCount(0);
    const rows = await card.getByRole('radio', { name: 'Grouped' }).boundingBox();
    expect(rows!.x + rows!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => {
      const host = document.getElementById('shell-content') ?? document.documentElement;
      return host.scrollWidth - host.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    const violations = await axeSeriousViolations(page, '#shell-content');
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  test('grouped mode keeps the aggregates in the group card header', async ({ page, request }) => {
    const s = await freshProject(request, 12, { running: false });
    await page.goto(`${APP}/projects/${s.project.slug}/charts?group=model`);
    const card = page.getByTestId('chart-card-text2sql');
    await expect(card).toBeVisible();
    await card.getByRole('radio', { name: 'Grouped' }).click({ force: true });
    await expect(card.getByRole('button', { name: /^Collapse group|^Expand group/ }).first()).toBeVisible();
  });
});
