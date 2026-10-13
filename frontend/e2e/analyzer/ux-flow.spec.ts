/** UX review (group C): history, double-submit, unsaved category edits, and tabs while a job runs. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  analysisUrl,
  analyzeButton,
  jobCard,
  previewDrawer,
  rail,
  seedAnalyzer,
  trackErrors,
  viewTabs,
  waitWorkspace,
} from './helpers';

test('the preview drawer is a deep link and Escape closes it without a history entry', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await rail(page).getByRole('button', { name: /^Prompt preview/ }).click();
  await expect(page).toHaveURL(/preview=1/);
  await expect(previewDrawer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/preview=1/);
  await expect(previewDrawer(page)).toHaveCount(0);
});

test('Back leaves Project guidance for the run workspace', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await viewTabs(page).getByRole('tab', { name: /^Diagnosis categories/ }).click();
  await expect(page).toHaveURL(/scope=categories/);
  await page.goBack();
  await expect(page).not.toHaveURL(/scope=/);
  await waitWorkspace(page);
});

test('a double click on Analyze starts one job', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/analysis-jobs')) posts.push(r.url());
  });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await analyzeButton(page).dblclick();
  await expect(jobCard(page)).toBeVisible();
  expect(posts).toHaveLength(1);
});

test('unsaved category edits ask before they are discarded', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  const t = trackErrors(page);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&scope=categories'));
  const description = page.getByLabel('Description').first();
  await description.fill('Edited but not saved');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  // leaving the page
  await page.getByRole('link', { name: 'Runs', exact: true }).first().click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog.getByText('Discard unsaved changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/analysis/);
  await expect(description).toHaveValue('Edited but not saved');
  // switching to another tab unmounts the draft: also asked
  await page.getByRole('tab', { name: /Production rules/ }).click();
  await expect(dialog.getByText('Discard unsaved changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/scope=rules/);
  await page.getByRole('tab', { name: /Diagnosis categories/ }).click();
  await expect(page.getByLabel('Description').first()).not.toHaveValue('Edited but not saved');
  expect(t.errors, t.errors.join('\n')).toEqual([]);
});

test('a running job is visible from the guidance tabs (dot, compact rail) and finishes there', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await analyzeButton(page).click();
  await expect(rail(page).getByRole('button', { name: /Cancel analysis|Analyze again/ })).toBeVisible();
  await viewTabs(page).getByRole('tab', { name: /^Diagnosis categories/ }).click();
  await expect(page).toHaveURL(/scope=categories/);
  const compact = page.getByRole('region', { name: 'Analysis job status' });
  await expect(compact).toBeVisible();
  await expect(compact).toContainText('succeeded', { timeout: 30_000 });
  // back to the run: the results are on the page, the tab carries no dot any more
  await compact.getByRole('button', { name: 'Open results' }).click();
  await expect(page).not.toHaveURL(/scope=/);
  await expect(jobCard(page)).toContainText('metric analyses succeeded');
  await expect(page.getByRole('img', { name: 'Analysis running' })).toHaveCount(0);
});
