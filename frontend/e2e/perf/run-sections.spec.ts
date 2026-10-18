/**
 * Perf round 6 (B8 to B10, B12): one segment at a time. The rows of the first request carry everything the report
 * sections read except the item texts (the `text` group); that group is requested once, when the Items section is
 * within a viewport of the screen, and never twice. Leaving the page aborts what is in flight.
 */
import { test, expect } from '@playwright/test';
import { seedClassic, seedProject, openRun, runUrl, showItems } from '../run-detail/support';
import { logRequests } from './support';

test.use({ viewport: { width: 1440, height: 900 } });

const rowRequests = (log: ReturnType<typeof logRequests>) =>
  log.filter((r) => /\/api\/runs\/[^/]+\?view=compact/.test(r.url));

test('after the Overview paints every group and chunk loads by itself; scrolling later requests nothing', async ({
  page,
}) => {
  const s = await seedProject('perf-groups');
  const runId = await seedClassic(s, { items: 300, traced: 3 });
  const log = logRequests(page);
  const chunks: string[] = [];
  const order: string[] = []; // every chunk and run request, in the order they were issued
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/\/(assets|src)\/.*\.(js|ts|tsx)/.test(u.pathname)) {
      chunks.push(r.url());
      order.push(u.pathname);
    } else if (u.pathname.startsWith('/api/runs/')) order.push(u.pathname + u.search);
  });
  await page.goto(runUrl(s.slug, runId));
  await expect(page.getByTestId('metric-card').first()).toBeVisible();
  // B8: no scroll, no click: the core request first, the texts right after, nothing else for the rows
  await expect
    .poll(() => rowRequests(log).filter((r) => r.url.includes('fields=text')).length, { timeout: 10_000 })
    .toBe(1);
  const urls = rowRequests(log).map((r) => r.url);
  expect(urls.some((u) => u.includes('fields=scores,reasons,categories,traces,review'))).toBe(true);
  expect(urls.filter((u) => u.includes('fields=text')).length).toBeLessThanOrEqual(2);
  expect(log.filter((r) => r.url.includes('view=summary')).length).toBeLessThanOrEqual(2); // 1 in production
  // B13: the Items table's chunk is asked for before the item texts and before the other panels' chunks
  await expect.poll(() => order.some((o) => o.includes('fields=text'))).toBe(true);
  const at = (needle: string) => order.findIndex((o) => o.includes(needle));
  expect(at('ItemsSection')).toBeGreaterThanOrEqual(0);
  expect(at('ItemsSection')).toBeLessThan(at('fields=text'));
  for (const later of ['LatencyTab', 'DeepTab', 'ErrorsTab', 'CategoriesTab'])
    if (at(later) >= 0) expect(at('ItemsSection'), later).toBeLessThanOrEqual(at(later));
  // B9: a run without reviews: no review-history request; summary + core + text = 3 run requests
  expect(log.some((r) => r.url.includes('review-history'))).toBe(false);
  expect(log.filter((r) => /\/api\/runs\/[^/]+\?view=/.test(r.url)).length).toBeLessThanOrEqual(6); // (3 in the production build; the dev server's StrictMode repeats some)
  // every panel chunk is requested without a scroll
  await expect
    .poll(
      () =>
        ['LatencyTab', 'DeepTab', 'CategoriesTab', 'ErrorsTab', 'ItemsSection'].every((n) =>
          chunks.some((c) => c.includes(n)),
        ),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  await page.waitForTimeout(800);

  // scrolling to any section after that fires no request (and shows no loading state for the texts)
  const before = log.length;
  await showItems(page);
  await page.waitForTimeout(800);
  await expect(page.getByRole('row').nth(1)).toContainText(/\S+/);
  expect(log.length).toBe(before);
});

test('switching sections and tabs causes no run request; leaving mid-load aborts the request', async ({
  page,
}) => {
  const s = await seedProject('perf-nav');
  const runId = await seedClassic(s, { items: 120 });
  await openRun(page, s.slug, runId);
  await page.waitForTimeout(1500);
  const log = logRequests(page);
  for (const name of ['Errors', 'Categories', 'Overview', 'Items']) {
    await page
      .getByRole('navigation', { name: /sections|report/i })
      .getByRole('link', { name })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // B10: only the lazy sections' own data (step latency) may load; never the run rows again
  expect(log.filter((r) => /\/api\/runs\/[^/]+\?view=/.test(r.url))).toEqual([]);

  // a second run, left while its rows are held
  const other = await seedClassic(s, { items: 60 });
  const aborted: string[] = [];
  page.on('requestfailed', (r) => {
    if (/view=compact/.test(r.url()) && /ABORTED/.test(r.failure()?.errorText ?? '')) aborted.push(r.url());
  });
  await page.route(
    '**/api/runs/*?view=compact&fields=*',
    (route) => void setTimeout(() => void route.continue().catch(() => {}), 4000),
  );
  await page
    .getByRole('link', { name: 'Runs', exact: true })
    .first()
    .click()
    .catch(() => {});
  await page.goto(runUrl(s.slug, other));
  await page.getByTestId('run-hero').waitFor();
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/projects/${s.slug}`);
  await expect.poll(() => aborted.length, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
});

test('deep links land on their section after the skeletons swap for content', async ({ page }) => {
  const s = await seedProject('perf-anchors');
  const runId = await seedClassic(s, { items: 80, traced: 3 });
  for (const hash of ['errors', 'categories', 'overview']) {
    await page.goto(runUrl(s.slug, runId) + `#${hash}`);
    await expect(page.getByTestId('items-count')).toBeVisible();
    await page.waitForTimeout(1200);
    const off = await page.evaluate((h) => {
      const el = document.getElementById(h === 'overview' ? 'run-section-overview' : `run-section-${h}`)!;
      const nav = document.querySelector('[data-run-nav]') as HTMLElement;
      return Math.abs(el.getBoundingClientRect().top - nav.getBoundingClientRect().bottom);
    }, hash);
    // within a section header's breathing room of the sticky line (the existing sections spec pins the exact value)
    expect(off, hash).toBeLessThanOrEqual(80);
  }
  await page.goto(runUrl(s.slug, runId, 'item=item-3'));
  await expect(
    page.getByRole('button', { name: 'Open item #4', exact: true }).or(page.getByText('item-3')).first(),
  ).toBeVisible();
});
