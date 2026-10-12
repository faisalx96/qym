/// <reference lib="dom" />
/** In-app docs (brief 09 §2, §8.9-10). */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gotoApp, trackPageLoads } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';

const here = path.dirname(fileURLToPath(import.meta.url));
const ia = JSON.parse(readFileSync(path.resolve(here, '../../src/features/docs/ia.json'), 'utf8')) as {
  sections: { id: string; pages: { id: string; title: string }[] }[];
};
const PAGES = ia.sections.flatMap((s) => s.pages.map((p) => ({ section: s.id, page: p.id, title: p.title })));
const FIRST = '/docs/get-started/what-is-qym';

const scroller = (page: Page) => page.evaluate(() => document.getElementById('shell-content')?.scrollTop ?? -1);

test.describe('routing', () => {
  test('legacy /docs-guide#developer/endpoints/conventions lands on the heading with the TOC entry current', async ({ page }) => {
    await gotoApp(page, '/docs-guide#developer/endpoints/conventions');
    await expect(page).toHaveURL(/\/docs\/developer\/endpoints#conventions$/);
    await expect(page.locator('#conventions')).toBeInViewport();
    await expect(page.locator('[data-docs-toc]:visible').getByRole('link', { name: 'Conventions' })).toHaveAttribute('aria-current', 'location');
  });

  for (const p of ['/docs-guide', '/docs']) {
    test(`${p} goes to the first page`, async ({ page }) => {
      await gotoApp(page, p);
      await expect(page).toHaveURL(new RegExp(`${FIRST}$`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('unknown page falls back to the first page', async ({ page }) => {
    await gotoApp(page, '/docs/nope/missing');
    await expect(page).toHaveURL(new RegExp(`${FIRST}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('deep link /docs/developer/endpoints#datasets scrolls to the heading', async ({ page }) => {
    await gotoApp(page, '/docs/developer/endpoints#datasets');
    await expect(page.locator('#datasets')).toBeInViewport();
    await expect(page.locator('[data-docs-toc]:visible').getByRole('link', { name: 'Datasets', exact: true })).toHaveAttribute('aria-current', 'location');
  });
});

test.describe('every page renders', () => {
  test(`all ${PAGES.length} pages show an h1 and log no console errors`, async ({ page }) => {
    test.setTimeout(180_000);
    expect(PAGES).toHaveLength(27);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    for (const p of PAGES) {
      await gotoApp(page, `/docs/${p.section}/${p.page}`);
      await expect(page.locator('[data-docs-article] h1').first(), `${p.section}/${p.page}`).toBeVisible();
      await expect(page.locator('[data-docs-article]')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('prev/next navigates in reading order and resets scroll', async ({ page }) => {
    await gotoApp(page, '/docs/get-started/install');
    const loads = trackPageLoads(page);
    await expect(page.locator('[data-docs-article] h1')).toBeVisible();
    await page.evaluate(() => {
      const s = document.getElementById('shell-content')!;
      s.scrollTop = 400;
    });
    expect(await scroller(page)).toBeGreaterThan(0);
    const pager = page.getByRole('navigation', { name: 'Previous and next page' });
    await pager.getByRole('link', { name: /Next/ }).click();
    await expect(page).toHaveURL(/\/docs\/get-started\/api-keys$/);
    await expect(page.locator('[data-docs-article] h1')).toBeVisible();
    await expect.poll(() => scroller(page)).toBe(0);
    await pager.getByRole('link', { name: /Previous/ }).click();
    await expect(page).toHaveURL(/\/docs\/get-started\/install$/);
    // First page has no Previous; last has no Next.
    await gotoApp(page, '/docs/get-started/what-is-qym');
    await expect(pager.getByRole('link', { name: /Previous/ })).toHaveCount(0);
    await gotoApp(page, '/docs/developer/cli');
    await expect(pager.getByRole('link', { name: /Next/ })).toHaveCount(0);
    expect(loads.count()).toBeGreaterThanOrEqual(1);
  });

  test('in-article cross-page link navigates through the router without a page load', async ({ page }) => {
    await gotoApp(page, '/docs/developer/api-overview');
    const loads = trackPageLoads(page);
    await expect(page.locator('[data-docs-article] h1')).toBeVisible();
    const link = page.locator('[data-docs-article] a[href="/docs/sdk-guide/observers"], [data-docs-article] a[href$="/docs/sdk-guide/observers"]').first();
    await expect(link).toBeVisible();
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(/\/docs\/sdk-guide\/observers$/);
    await expect(page.locator('[data-docs-article] h1')).toBeVisible();
    expect(loads.count()).toBe(0);
  });
});

test.describe('search', () => {
  test('"/" focuses search; a body-only term lists results with crumbs; ArrowDown+Enter opens; Escape clears', async ({ page }) => {
    await gotoApp(page, '/docs/get-started/what-is-qym');
    await expect(page.locator('[data-docs-article] h1')).toBeVisible();
    const input = page.getByRole('combobox');
    await page.keyboard.press('/');
    await expect(input).toBeFocused();
    await input.fill('metric_max_retries');
    const list = page.getByRole('listbox', { name: 'Search results' });
    await expect(list).toBeVisible();
    const options = list.getByRole('option');
    await expect(options.first()).toContainText('›');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
    const first = options.first();
    const second = count > 1 ? options.nth(1) : first;
    await page.keyboard.press('ArrowDown');
    if (count > 1) await expect(second).toHaveAttribute('aria-selected', 'true');
    const crumb = (await second.locator('span').first().textContent()) ?? '';
    const pageTitle = crumb.split('›')[1]!.trim();
    await page.keyboard.press('Enter');
    await expect(list).toHaveCount(0);
    await expect(page).toHaveURL(/\/docs\/[^/]+\/[^/#]+/);
    await expect(page.locator('[data-docs-article] h1')).toContainText(pageTitle.split(' ')[0]!);
    await expect(input).toHaveValue('');

    await page.keyboard.press('/');
    await input.fill('exact_match');
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect(list).toHaveCount(0);
  });

  test('"No results" for nonsense; "/" is ignored while typing in an input', async ({ page }) => {
    await gotoApp(page, '/docs/get-started/what-is-qym');
    const input = page.getByRole('combobox');
    await input.click();
    await input.fill('zzqqxxnotaterm');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('No results for “zzqqxxnotaterm”');
    await input.fill('a/b');
    await expect(input).toHaveValue('a/b');
  });
});

test('copy button puts the exact code on the clipboard and says Copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoApp(page, '/docs/developer/api-overview');
  const block = page.locator('[data-docs-codeblock]').first();
  await expect(block).toBeVisible();
  const expected = (await block.locator('pre').textContent()) ?? '';
  expect(expected.length).toBeGreaterThan(0);
  await block.getByRole('button', { name: 'Copy code' }).click();
  await expect(page.getByText('Copied to clipboard')).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(expected);
});

test.describe('narrow viewport (760px)', () => {
  test.use({ viewport: { width: 760, height: 900 } });
  test('nav toggle and the "On this page" disclosure work', async ({ page }) => {
    await gotoApp(page, '/docs/developer/endpoints');
    await expect(page.locator('[data-docs-article] h1')).toBeVisible();
    const toggle = page.getByRole('button', { name: /Browse docs/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#docs-nav')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#docs-nav')).toBeVisible();
    await page.locator('#docs-nav').getByRole('link', { name: 'Authentication' }).first().click();
    await expect(page).toHaveURL(/\/docs\/developer\/auth$/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    const summary = page.locator('summary', { hasText: 'On this page' });
    await expect(summary).toBeVisible();
    await summary.click();
    const details = page.locator('details');
    await expect(details).toHaveAttribute('open', '');
    await expect(details.getByRole('link').first()).toBeVisible();
  });
});

test('axe: /docs/developer/endpoints has zero serious/critical violations', async ({ page }) => {
  await gotoApp(page, '/docs/developer/endpoints');
  await expect(page.locator('[data-docs-article] h1')).toBeVisible();
  const v = await axeSeriousViolations(page);
  expect(v, describeViolations(v)).toEqual([]);
});

test('pager does not overflow horizontally on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await gotoApp(page, '/docs/sdk-guide/config');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});
