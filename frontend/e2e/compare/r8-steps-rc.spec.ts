/** Round 8: Step latency (C-step-1) and Root cause (C-rc-1) appear only with data, in the averages and error-card recipes. */
import { expect, test } from '@playwright/test';
import { client, itemHead } from './support';
import { createApiKey, seedTracedRun } from './seed';
import { box, openCompare, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
let traced = '';
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-step');
  traced = await seedTracedRun(client, await createApiKey(client, s.seed.projectId), 'r8-step-traced');
});

test('C-step-1: no Steps section without spans; with a traced run one table in the averages recipe', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  await expect(part(page, 'section-steps')).toHaveCount(0);
  await expect(part(page, 'section-nav').getByRole('link', { name: 'Steps' })).toHaveCount(0);
  await openCompare(page, [traced, s.seed.runs.base], 1440);
  await expect(part(page, 'section-steps')).toBeVisible();
  await expect(part(page, 'section-nav').getByRole('link', { name: 'Steps' })).toBeVisible();
  const table = part(page, 'steps-table');
  await expect(table).toBeVisible();
  const heads = table.locator('thead [data-part="run-name"]');
  await expect(heads).toHaveCount(2);
  await expect(table.getByRole('columnheader', { name: 'Step', exact: true })).toBeVisible();
  const cell = table.locator('tbody td').first();
  within((await box(cell)).h, 44, 2, 'step cell');
  // order: Averages, Overview, Categories, Steps, Errors
  const order = await page.locator('[data-report-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-part')));
  expect(order.indexOf('section-steps')).toBeGreaterThan(order.indexOf('section-categories'));
  expect(order.indexOf('section-steps')).toBeLessThan(order.indexOf('section-errors'));
});

test('C-rc-1: no Root cause section without analyses; an issue adds one card per category that filters on click', async ({
  page,
}) => {
  const { base, a } = s.seed.runs;
  await openCompare(page, [base, a], 1440);
  await expect(part(page, 'section-root-cause')).toHaveCount(0);
  await itemHead(page, 'cmp-004').click();
  await page.locator(`[data-testid="output-card"][data-run="${base}"]`).getByRole('button', { name: 'Add issue' }).click();
  const dialog = page.getByTestId('issue-dialog');
  await dialog.getByRole('button', { name: /Category/ }).click();
  await page.getByRole('option', { name: 'New category…' }).click();
  await dialog.getByRole('textbox', { name: 'New category' }).fill('Hallucination');
  await dialog.getByRole('textbox', { name: 'Finding' }).fill('Invented a clause number');
  await page.getByTestId('issue-save').click();
  await expect(dialog).toHaveCount(0);
  const cards = part(page, 'root-cause-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Hallucination');
  await expect(cards.first()).toContainText('1 issue');
  await expect(cards.first().locator('[data-part="root-cause-run"]')).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute('role', 'button');
  await cards.first().click();
  await expect(part(page, 'baseline-delta-banner')).toContainText('Root cause: Hallucination');
  await expect(page.getByRole('status').filter({ hasText: /of 40 items/ })).toContainText('1 of 40');
});
