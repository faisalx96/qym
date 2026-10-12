/** UX review (group C): wizard history, double-submit, unsaved category edits, Review from the guidance scope. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, seedAnalyzer, step, trackErrors, waitWorkspace } from './helpers';

test('Back walks the wizard steps instead of leaving the workspace', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await step(page, 'Preview').click();
  await step(page, 'Run').click();
  await expect(page).toHaveURL(/step=run/);
  await page.goBack();
  await expect(page).toHaveURL(/step=preview/);
  await expect(step(page, 'Preview')).toHaveAttribute('aria-current', 'step');
  await page.goBack();
  await expect(page).not.toHaveURL(/step=/);
  await expect(step(page, 'Configure')).toHaveAttribute('aria-current', 'step');
});

test('Back leaves Project guidance for the run workspace', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await page.getByText('Project guidance', { exact: true }).first().click();
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
  await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&step=run'));
  await waitWorkspace(page);
  await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).dblclick();
  await expect(page.getByRole('region', { name: 'Analysis job' })).toBeVisible();
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
  // switching to another guidance tab unmounts the draft: also asked
  await page.getByRole('tab', { name: /Production rules/ }).click();
  await expect(dialog.getByText('Discard unsaved changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/scope=rules/);
  await page.getByRole('tab', { name: /Diagnosis categories/ }).click();
  await expect(page.getByLabel('Description').first()).not.toHaveValue('Edited but not saved');
  expect(t.errors, t.errors.join('\n')).toEqual([]);
});

test('Review results from the guidance scope opens the Review step of the run workspace', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&step=run'));
  await waitWorkspace(page);
  await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
  await page.getByText('Project guidance', { exact: true }).first().click();
  await expect(page).toHaveURL(/scope=categories/);
  const bar = page.getByRole('region', { name: 'Analysis job' });
  await expect(bar.getByText(/COMPLETED/i)).toBeVisible({ timeout: 20_000 });
  await bar.getByRole('button', { name: /Review results/ }).click();
  await expect(page).toHaveURL(/step=review/);
  await expect(page).not.toHaveURL(/scope=/);
  await expect(step(page, 'Review')).toHaveAttribute('aria-current', 'step');
});
