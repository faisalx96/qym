/**
 * The incomplete-ingest notice on the run page (cutover of test_ingest_incomplete_browser.py): it names the
 * rejected events as text (the names come from the client), lists the first few and counts the rest, and a run
 * without the flag has no banner.
 */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;
test.beforeAll(async () => {
  s = await seedProject('rd-ingest');
  classic = await seedClassic(s);
});

const XSS_ID = '<img src=x onerror="window.__injected=1">';
const XSS_ERR = '"><script>window.__injected=2</script>';

test('rejected events are named as text, the first ones listed and the rest counted', async ({ page }) => {
  await page.route(new RegExp(`/api/runs/${classic}\\?`), async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.run.metadata = {
      ...body.run.metadata,
      ingest_incomplete: {
        expected_items: 250,
        received_items: 249,
        rejected_events: 12,
        rejected: [
          { type: 'item_completed', item_id: XSS_ID, sequence: 7, error: XSS_ERR },
          { type: 'metric_scored', item_id: null, sequence: 0, error: null },
        ],
      },
    };
    await route.fulfill({ response, json: body });
  });
  await openRun(page, s.slug, classic);
  const banner = page.getByTestId('ingest-warning');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Incomplete data');
  await expect(banner).toContainText('only 249');
  await expect(banner).toContainText('1 missing');
  await expect(banner).toContainText('rejected 12 events');
  const items = banner.getByRole('listitem');
  await expect(items.nth(0)).toContainText(`item_completed for item ${XSS_ID}: ${XSS_ERR}`);
  await expect(items.nth(1)).toContainText('metric_scored #0: rejected');
  await expect(banner).toContainText(/10 more/);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __injected?: number }).__injected),
  ).toBeUndefined();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a run without the flag has no banner', async ({ page }) => {
  await openRun(page, s.slug, classic);
  await expect(page.getByTestId('ingest-warning')).toHaveCount(0);
});
