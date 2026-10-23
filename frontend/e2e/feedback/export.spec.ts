/// <reference lib="dom" />
/** G6, QE-173 to QE-184: the administrator's Export menu. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { gotoApp } from '../helpers';
import { asMember, configureAgent, seedFeedback, setViewport, shot, tableOf } from './support';

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await configureAgent(request);
  seedFeedback(0);
});

test('QE-179: an administrator opens the menu with four items; the member sees none', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  const button = page.getByTestId('export-menu');
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['CSV', 'Excel (.xlsx)', 'JSON', 'JSON Lines']);
  await shot(page, 'export-menu', 1440);
  await page.keyboard.press('Escape');
  const member = await page.context().newPage();
  await asMember(member);
  await setViewport(member, 1440);
  await gotoApp(member, '/feedback');
  await expect(member.getByTestId('feedback-list-page')).toBeVisible();
  await expect(member.getByTestId('export-menu')).toHaveCount(0);
});

test('QE-174, QE-177, QE-182: CSV and JSON downloads carry the current filter', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback?priority=high');
  await expect(tableOf(page)).toBeVisible();
  const [csv] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByTestId('export-menu').click();
    await page.getByRole('menuitem', { name: 'CSV' }).click();
  })()]);
  expect(csv.suggestedFilename()).toMatch(/^feedback-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = fs.readFileSync((await csv.path())!, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
    'id,title,subject,project,target_kind,target_id,priority,complexity,status,submitter,created_at,confirmed_at,duplicate_of,conflicts,summary,description,business_need,justification,agent_priority,agent_complexity',
  );
  const [json] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByTestId('export-menu').click();
    await page.getByRole('menuitem', { name: 'JSON', exact: true }).click();
  })()]);
  const rows = JSON.parse(fs.readFileSync((await json.path())!, 'utf8')) as { priority: string }[];
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map((r) => r.priority))).toEqual(new Set(['high']));
});

test('QE-180: the menu is disabled with a tooltip when nothing matches', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback?q=zzzz-no-such-request');
  await expect(page.getByTestId('export-disabled')).toHaveAttribute('title', 'No requests to export');
  await expect(page.getByTestId('export-menu')).toBeDisabled();
});
