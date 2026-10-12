/** UX review (group C): an action taken offline fails visibly instead of waiting with a spinner and firing later. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, seedAnalyzer, waitWorkspace } from './helpers';

test('Analyze while offline reports the failure, starts nothing, and can be retried online', async ({
  page,
  context,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/analysis-jobs')) posts.push(r.url());
  });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&step=run'));
  await waitWorkspace(page);
  const analyze = page.getByRole('button', { name: /^Analyze \d+ items?$/ });
  await context.setOffline(true);
  await analyze.click();
  await expect(page.getByText('The analysis could not be started.')).toBeVisible();
  await expect(analyze).toBeEnabled();
  await context.setOffline(false);
  await page.waitForTimeout(1200);
  expect(posts).toHaveLength(1); // the failed attempt only; nothing queued behind the user's back
  await analyze.click();
  await expect(page.getByRole('region', { name: 'Analysis job' })).toBeVisible();
});
