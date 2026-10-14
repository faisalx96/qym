/**
 * One heading scale (final review F13): H1 22/650, section H2 18/650, panel H3 15/600. Every visible heading on
 * the audited pages is one of these (a heading that wraps a disclosure button is styled by its button).
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { createLaunchAreas, seedTour, settled, type AreasWorld, type Tour } from './support';

let tour: Tour;
let areas: AreasWorld;
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  tour = await seedTour();
  areas = await createLaunchAreas(request);
});
test.use({ viewport: { width: 1440, height: 900 } });

const SCALE = new Set(['22px/650', '18px/650', '15px/600']);

async function headings(page: Page): Promise<string[]> {
  // lazy sections mount as they scroll into view
  await page.evaluate(async () => {
    const host = document.querySelector<HTMLElement>('#shell-content') ?? document.documentElement;
    for (let y = 0; y < host.scrollHeight; y += 700) {
      host.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
  });
  await settled(page);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main h1, main h2, main h3'))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !e.querySelector('button');
      })
      .map((e) => {
        const cs = getComputedStyle(e);
        return `${cs.fontSize}/${cs.fontWeight} ${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
      }),
  );
}

const pages: { name: string; path: () => string; ready?: (page: Page) => Promise<void> }[] = [
  { name: 'overview', path: () => `/projects/${tour.slug}/overview` },
  { name: 'charts', path: () => `/projects/${tour.slug}/charts` },
  { name: 'runs', path: () => `/projects/${tour.slug}` },
  { name: 'admin runs', path: () => '/admin/runs' },
  { name: 'models', path: () => `/projects/${tour.slug}/models` },
  {
    name: 'run detail',
    path: () => runUrl(tour.slug, tour.runId),
    ready: (page) => expect(page.getByTestId('items-count')).toBeVisible(),
  },
  {
    name: 'repeat run',
    path: () => `${runUrl(tour.slug, tour.repeatId)}?panel=repeat`,
    ready: (page) => expect(page.getByTestId('items-count')).toBeVisible(),
  },
  { name: 'analysis', path: () => `/projects/${areas.analysisSlug}/analysis?run=${areas.runId}` },
];

for (const p of pages) {
  test(`${p.name}: every heading is on the scale`, async ({ page }) => {
    await gotoApp(page, p.path());
    await expect(page.getByRole('main')).toBeVisible();
    await p.ready?.(page);
    await settled(page);
    const found = await headings(page);
    expect(found.length).toBeGreaterThan(0);
    const off = found.filter((h) => !SCALE.has(h.split(' ')[0]!));
    expect(off, `${p.name}: headings off the 22/18/15 scale`).toEqual([]);
  });
}

test('analysis: sections are H2 18px, panels H3 15px, no H3 larger than an H2', async ({ page }) => {
  await gotoApp(page, `/projects/${areas.analysisSlug}/analysis?run=${areas.runId}`);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Setup', exact: true })).toBeVisible();
  await settled(page);
  const sizes = await page.evaluate(() => {
    const size = (tag: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`main ${tag}`))
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => parseFloat(getComputedStyle(e).fontSize));
    return { h2: size('h2'), h3: size('h3') };
  });
  expect(sizes.h2.length).toBeGreaterThanOrEqual(3);
  expect(new Set(sizes.h2), 'every section H2').toEqual(new Set([18]));
  for (const h3 of sizes.h3) expect(h3, 'an H3 is a panel heading (15px)').toBeLessThanOrEqual(15);
});
