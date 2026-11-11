/**
 * C070: pages hold each section's loaded height from the first frame, so nothing pushes the content down while it loads.
 * The check fails above 0.05 cumulative layout shift (the "good" bound) on the pages the review measured.
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { sharedProject } from '../runs-list/support';

const SHIFT_OBSERVER = `
window.__cls = 0;
new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
  .observe({ type: 'layout-shift', buffered: true });`;

const cls = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __cls: number }).__cls);

test.use({ viewport: { width: 1440, height: 900 } });

test('Dashboard, Charts, Runs, Experiments and Maintenance shift less than 0.05 while they load', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 12);
  await page.addInitScript(SHIFT_OBSERVER);
  for (const path of [
    `/projects/${s.project.slug}/overview`,
    `/projects/${s.project.slug}/charts`,
    `/projects/${s.project.slug}`,
    `/projects/${s.project.slug}/experiments`,
    '/admin/maintenance',
  ]) {
    await gotoApp(page, path);
    await page.waitForLoadState('networkidle');
    expect(await cls(page), path).toBeLessThan(0.05);
  }
});
