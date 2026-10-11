/// <reference lib="dom" />
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';

test('axe: each admin tab has zero serious/critical violations', async ({ page }) => {
  test.setTimeout(90_000);
  for (const tab of ['runs', 'projects', 'users', 'maintenance']) {
    await gotoApp(page, `/admin/${tab}`);
    await expect(page.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').first().locator('[role=grid], [data-maintenance-summary], [data-stats-error]').first()).toBeVisible();
    const v = await axeSeriousViolations(page);
    expect(v, `${tab}\n${describeViolations(v)}`).toEqual([]);
  }
});

// The dialog fades in (200 ms); axe must measure the settled colours, not a mid-fade blend.
test('axe: edit user dialog', async ({ page }) => {
  await gotoApp(page, '/admin/users');
  await page.getByRole('grid', { name: 'Users' }).getByRole('button', { name: /^Edit / }).first().click();
  await expect(page.getByRole('dialog', { name: /^Edit / })).toBeVisible();
  await page.waitForTimeout(600);
  const v = await axeSeriousViolations(page);
  expect(v, describeViolations(v)).toEqual([]);
});
