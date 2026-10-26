/** Scenario 10: different-data, partial alignment and read-only (archived project) notices. */
import { expect, request as pwRequest, test } from '@playwright/test';
import { archiveProject, unarchiveProject } from '../helpers';
import { client, compareUrl, seedScenario, waitLoaded } from './support';
import { createApiKey, seedCompareRunOnDataset, type CompareSeed } from './seed';

let seed: CompareSeed;
let otherDataset: string;
let archived: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-note');
  const token = await createApiKey(client, seed.projectId);
  otherDataset = await seedCompareRunOnDataset(client, token, 'cmp-qa-v2', 'other-dataset', 10);
  archived = await seedScenario('cmp-arch');
});

test('runs on different dataset names show the Different data notice', async ({ page }) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a, otherDataset]));
  await waitLoaded(page);
  const note = page.locator('[data-notice="different-data"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Different data.');
  await expect(note).toContainText('different datasets');
  await expect(note).toContainText('cmp-qa-v1');
  await expect(note).toContainText('cmp-qa-v2');
  await expect(note).toContainText('only items present in both runs are paired');
  await expect(page.locator('[data-notice="read-only"]')).toHaveCount(0);
});

test('same-dataset runs need no notice', async ({ page }) => {
  const { base, a, b } = seed.runs;
  await page.goto(compareUrl([base, a, b]));
  await waitLoaded(page);
  await expect(page.locator('[data-notice]')).toHaveCount(0);
});

test('a shorter run on the same dataset: only shared items are aligned and the missing ones show no score', async ({
  page,
}) => {
  const { base, other } = seed.runs;
  await page.goto(compareUrl([base, other, seed.runs.a]));
  await waitLoaded(page);
  // 40-item runs plus one 10-item run on the same ids: every id is aligned, the short run simply has no row for 11..40
  await expect(page.getByText(/\d+ aligned items/)).toBeVisible();
  await page.locator('[data-part="item-head"]').click();
  const detail = page.getByTestId('item-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('output-card')).toHaveCount(2); // base and cand-a only; the short run has no row for cmp-020
  await expect(page.locator('[data-notice="alignment"]')).toHaveCount(0);
});

test('archived project: read-only notice, no score pencil and no Add issue', async ({ page }) => {
  const { base, a } = archived.runs;
  const api = await pwRequest.newContext({ baseURL: client.baseUrl });
  await archiveProject(api, archived.projectId);
  try {
    await page.goto(compareUrl([base, a, archived.runs.c]));
    await waitLoaded(page);
    const note = page.locator('[data-notice="read-only"]');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Read-only.');
    await expect(note).toContainText('archived project');
    await page.locator('[data-part="item-head"]').click();
    await expect(page.getByTestId('output-card')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Edit .* score of/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add issue' })).toHaveCount(0);
  } finally {
    await unarchiveProject(api, archived.projectId);
    await api.dispose();
  }
});
