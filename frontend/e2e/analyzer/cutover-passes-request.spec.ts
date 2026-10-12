/// <reference lib="dom" />
/** C027: /passes is fetched (and its server work paid) only for repeat runs. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, seedAnalyzer, waitWorkspace } from './helpers';

test('the analyzer requests /passes for a repeat run and never for a single-sample run', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request, { withRepeat: true });
  const passRequests: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/runs\/[^/]+\/passes/.test(r.url())) passRequests.push(r.url());
  });

  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  expect(passRequests).toEqual([]);

  await gotoApp(page, analysisUrl(seed.slug, seed.repeatId as string, '&pass=1'));
  await waitWorkspace(page);
  await expect.poll(() => passRequests.length).toBeGreaterThan(0);
  expect(passRequests.every((u) => u.includes(seed.repeatId as string))).toBe(true);
});
