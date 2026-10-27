/// <reference lib="dom" />
/**
 * Multi-dataset round, WP-C (spec-c.md section 4): the run page of a union run (3 dataset versions, one run),
 * seeded through the public API as SDK 2.1.0 uploads it. Numbers are measured at 1440, 1024 and 390 px.
 */
import { test, expect, type Page } from '@playwright/test';
import { client, axeSeriousViolations, describeViolations } from './support';
import { manyEntries, seedSingleRunOn, seedUnionRun, type UnionRun } from './unionSeed';

let union: UnionRun;
let singleId: string;
let many: UnionRun;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  union = await seedUnionRun(client, { slug: `md-union-${Date.now().toString(36)}` });
  singleId = await seedSingleRunOn(client, union, 'ticket-triage-nightly', 'support-tickets', 412, 0.661);
  many = await seedUnionRun(client, {
    slug: `md-many-${Date.now().toString(36)}`,
    name: 'nightly-all-sets',
    entries: manyEntries(),
  });
});

const WIDTHS = [1440, 1024, 390] as const;
const url = (s: UnionRun, id = s.runId, query = '') => `/projects/${s.slug}/runs/${id}${query}`;

async function open(page: Page, width: number, to: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(to);
  await expect(page.getByTestId('run-hero')).toBeVisible();
  await expect(page.getByTestId('items-count')).toBeVisible();
}

const size = async (page: Page, selector: string, nth = 0) => {
  const box = await page.locator(selector).nth(nth).boundingBox();
  expect(box, selector).not.toBeNull();
  return { w: Math.round(box!.width * 10) / 10, h: Math.round(box!.height * 10) / 10 };
};

// Measured on the product 2026-10-22 (impl-notes-c.md); the spec's mock numbers are in the comments.
const BAND = { 1440: 41.5, 1024: 71, 390: 193 } as const; // QC-U4 (spec 33.5 / 63 / 185: the real band adds the closed Collapse's 8 px)
// QC-U12 (spec 339.5 / 351.5 / 682.4); round 8b (owner decision H6): the 69 px lead-in of the old head went, the 30 px panel came
const SECTION = { 1440: 297.9, 1024: 297.9, 390: 635.6 } as const;

test.describe('union run page', () => {
  for (const width of WIDTHS) {
    test(`hero, facts and chips at ${width}`, async ({ page }) => {
      await open(page, width, url(union));
      const hero = await size(page, '[data-testid=run-hero]');
      const columns = { 1440: 1193, 1024: 777, 390: 279 } as const;
      expect(hero.w).toBe(columns[width]); // QC-U1: the card does not change width
      // QC-U2: seven facts, strip height unchanged from the single-dataset run
      await page.goto(url(union, singleId));
      const single = await size(page, '[data-testid=run-hero]');
      const singleStrip = await size(page, '[data-testid=run-hero-strip]');
      await page.goto(url(union));
      const strip = await size(page, '[data-testid=run-hero-strip]');
      expect(strip.h).toBe(singleStrip.h);
      expect(strip.h).toBeCloseTo({ 1440: 39.2, 1024: 81.4, 390: 185.8 }[width], 0);
      await expect(page.locator('[data-testid=run-hero-strip] dt', { hasText: /^Datasets$/ })).toHaveCount(1);
      // QC-U3: the count tag is a link to the section, 92 x 20
      const tag = await size(page, '[data-testid=hero-datasets-fact] > *');
      expect(tag).toEqual({ w: 92, h: 20 });
      await expect(page.getByTestId('hero-datasets-fact')).toHaveAttribute('href', /#run-section-datasets$/);
      await expect(page.getByTestId('hero-datasets-fact').locator('[title]')).toHaveAttribute(
        'title',
        /support-tickets v1/,
      );
      // QC-U4: band height and the delta over the same run with one dataset (which has the same other chips)
      const band = await size(page, '[data-testid=hero-context]');
      expect(Math.abs(band.h - BAND[width])).toBeLessThanOrEqual(2);
      expect(Math.abs(hero.h - single.h)).toBeLessThanOrEqual(width === 1440 ? 2 : 160);
      // QC-U5/U6: three chips in list order; no name is cut
      const chips = page.getByTestId('hero-dataset-chip');
      await expect(chips).toHaveCount(3);
      const first = await size(page, '[data-testid=hero-dataset-chip]', 0);
      const third = await size(page, '[data-testid=hero-dataset-chip]', 2);
      if (width === 390) {
        expect(first).toEqual({ w: 169.3, h: 45 });
        expect(third.w).toBeLessThanOrEqual(235);
      } else {
        expect(first).toEqual({ w: 209.2, h: 24.5 });
        expect(third).toEqual({ w: 248.6, h: 24.5 });
      }
      for (let i = 0; i < 3; i++) {
        const cut = await chips.nth(i).evaluate((e) => ({
          overflow: e.scrollWidth > e.clientWidth + 1,
          ellipsis: getComputedStyle(e.querySelector('span:nth-of-type(1)')!).textOverflow,
        }));
        expect(cut).toEqual({ overflow: false, ellipsis: 'clip' });
      }
      // QC-U7: a live dataset's chip links to its version page
      await expect(chips.first()).toHaveAttribute(
        'href',
        new RegExp(`/projects/${union.slug}/datasets/support-tickets\\?v=v1$`),
      );
      // QC-U9/U10: the group is a labelled list of list items
      const group = page.getByRole('list', { name: 'Datasets' });
      await expect(group.getByRole('listitem')).toHaveCount(3);
    });
  }

  for (const width of WIDTHS) {
    test(`Datasets section, nav and table at ${width}`, async ({ page }) => {
      await open(page, width, url(union));
      // QC-U11: the nav entry follows Overview with the count; the nav stays 44 px
      const links = page.locator('[data-section]');
      await expect(links.nth(1)).toHaveText('Overview');
      await expect(links.nth(2)).toHaveText(/^Datasets\s*3$/);
      expect((await size(page, '[data-section="datasets"]')).h).toBeLessThan(44);
      const nav = await page
        .locator('[data-section="overview"]')
        .evaluate((e) => e.closest('div,nav')!.getBoundingClientRect().height);
      expect(nav).toBe(44);
      // QC-U12: the section sits between Overview and Latency with the verbatim description
      const ids = await page.locator('[data-report-section]').evaluateAll((els) => els.map((e) => e.id));
      expect(ids.indexOf('run-section-datasets')).toBe(ids.indexOf('run-section-overview') + 1);
      const section = page.locator('#run-section-datasets');
      await section.scrollIntoViewIfNeeded();
      await expect(section).toContainText(
        'Scores per source dataset. The run’s own mean is the summary row; the grey figure is each dataset’s distance from it.',
      );
      await expect(section.getByTestId('dataset-breakdown')).not.toContainText('Loading');
      await expect(page.locator('[data-testid=show-items-link]').first()).toBeVisible();
      const sectionBox = await size(page, '#run-section-datasets');
      expect(Math.abs(sectionBox.h - SECTION[width]), `section height ${sectionBox.h}`).toBeLessThanOrEqual(width === 390 ? 12 : 6);
      if (width !== 390) {
        // QC-U13: the table is the column minus its frame and never scrolls sideways
        const table = await page
          .getByRole('table', { name: 'Scores per dataset' })
          .or(page.getByRole('grid', { name: 'Scores per dataset' }))
          .first();
        const box = await table.boundingBox();
        expect(box!.width).toBe(width === 1440 ? 1161 : 753);
        expect(box!.height).toBe(210);
        const scroll = await table.evaluate((e) => {
          const host = e.closest('[data-datatable],div') as HTMLElement;
          return host.scrollWidth - host.clientWidth;
        });
        expect(scroll).toBeLessThanOrEqual(1);
      }
    });
  }

  test('scores, deltas and the summary row agree with the Overview (QC-U14 to QC-U17)', async ({ page }) => {
    await open(page, 1440, url(union));
    const section = page.locator('#run-section-datasets');
    await section.scrollIntoViewIfNeeded();
    const text = (await section.innerText()).replace(/\s+/g, ' ');
    for (const name of ['answer_correctness', 'faithfulness', 'tone'])
      expect(text.toLowerCase()).toContain(name);
    // the three rows of the mock: 66.1 / 70.8 / 71.9 % for answer_correctness and the deltas against 68.9
    expect(text).toContain('66.1%');
    expect(text).toContain('−2.8');
    expect(text).toContain('70.8%');
    expect(text).toContain('+1.9');
    expect(text).toContain('71.9%');
    expect(text).toContain('+3.0');
    // the summary row carries the run's own means, equal to the Overview cards
    expect(text).toMatch(/All datasets\s+946\s+8\s+68\.9%\s+85\.5%\s+78\.1%/);
    const cards = await page.locator('[data-testid=metric-card]').allInnerTexts();
    const joined = cards.join(' ');
    expect(joined).toContain('68.9%');
    expect(joined).toContain('85.5%');
    expect(joined).toContain('78.1%');
    // no untagged row for a tagged run
    await expect(section).not.toContainText('Not tagged');
  });

  test('Show 412 narrows the items client-side (QC-U18, QC-U22 to QC-U26)', async ({ page }) => {
    await open(page, 1440, url(union));
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
    await page.getByTestId('show-items-link').first().click();
    await expect(page).toHaveURL(/dataset=support-tickets%40v1/);
    await expect(page.getByTestId('items-count')).toHaveText('412 items');
    await expect(
      page.getByRole('button', { name: 'Remove filter Dataset: support-tickets v1' }),
    ).toBeVisible();
    // the page-wide scope follows; the Datasets section is the breakdown of the whole run and does not
    await expect(page.locator('#run-section-overview')).toContainText('over 412 of 946 items');
    await expect(page.locator('#run-section-datasets')).toContainText('All datasets');
    expect(requests.filter((u) => u.includes('/datasets'))).toEqual([]);
    // removing the chip returns to all
    // (the quick-filters sidebar that a scope opens sits over the bar's right end at 1440: press through the DOM)
    await page
      .getByRole('button', { name: 'Remove filter Dataset: support-tickets v1' })
      .dispatchEvent('click');
    await expect(page.getByTestId('items-count')).toHaveText('946 items');
    await expect(page).not.toHaveURL(/dataset=/);
    // the URL form works as a link
    await page.goto(url(union, union.runId, '?dataset=support-tickets%40v2'));
    await expect(page.getByTestId('items-count')).toHaveText('438 items');
    await expect(page.getByTestId('dataset-filter')).toContainText('support-tickets v2');
  });

  test('items: Dataset column, raw ids and distinct rows for shared ids (QC-U24, QC-U25, QC-U28)', async ({
    page,
  }) => {
    await open(page, 1440, url(union));
    await page.locator('#run-items').scrollIntoViewIfNeeded();
    const header = page.getByRole('treegrid', { name: 'Items' }).getByRole('columnheader');
    await expect(header.filter({ hasText: /^Dataset$/ })).toBeVisible();
    await expect(header.filter({ hasText: /^Item$/ })).toBeVisible();
    // t-0001 exists in both versions of support-tickets and in billing-faq: three rows, one per dataset
    await page.getByRole('searchbox', { name: /Search inputs/ }).fill('t-0001');
    await expect(page.getByTestId('items-count')).toHaveText('3 items');
    const rows = page.locator('[data-item-id]');
    await expect(rows).toHaveCount(3);
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((i) => i!.includes('@') && i!.endsWith('/t-0001'))).toBe(true);
    // the Item column shows the raw id; the full id is its title
    const itemCell = rows.first().getByText('t-0001', { exact: true });
    await expect(itemCell).toBeVisible();
    // opening one addresses it by its namespaced id
    await rows.nth(1).click();
    await expect(page).toHaveURL(/item=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('item')!)).toBe(ids[1]);
  });

  test('loading frame has the loaded height (QC-U20, QC-U42)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/runs\/[^/]+\/datasets/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(url(union));
    const section = page.locator('#run-section-datasets');
    await expect(section).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('show-items-link')).toHaveCount(0);
    const loading = await size(page, '#run-section-datasets');
    // the real dataset cells are there while the numbers load
    await expect(section).toContainText('support-tickets');
    release();
    await expect(page.getByTestId('show-items-link').first()).toBeVisible();
    const loaded = await size(page, '#run-section-datasets');
    expect(Math.abs(loaded.h - loading.h)).toBeLessThanOrEqual(1);
  });

  test('an error leaves the page intact with Retry (QC-U21)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(/\/api\/runs\/[^/]+\/datasets/, (route) =>
      route.fulfill({ status: 500, body: '{"detail":"boom"}' }),
    );
    await page.goto(url(union));
    const section = page.locator('#run-section-datasets');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('alert')).toContainText('Couldn’t load the datasets');
    await expect(section.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByTestId('items-count')).toBeVisible();
  });

  test('keyboard path and focus rings (QC-U29)', async ({ page }) => {
    await open(page, 1440, url(union));
    await page
      .getByTestId('hero-datasets-fact')
      .locator('..')
      .locator('..')
      .focus()
      .catch(() => undefined);
    // Tab from the top of the page: the Datasets fact comes before the chips, the chips before the section nav
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [];
    let chipOutline = '';
    for (let i = 0; i < 40 && !seen.includes('chip'); i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e) return { id: '', outline: '' };
        const id =
          e.dataset.testid === 'hero-datasets-fact'
            ? 'fact'
            : e.dataset.testid === 'hero-dataset-chip'
              ? 'chip'
              : '';
        return { id, outline: getComputedStyle(e).outlineWidth + ' ' + getComputedStyle(e).outlineStyle };
      });
      if (info.id) seen.push(info.id);
      if (info.id === 'chip') chipOutline = info.outline;
    }
    expect(seen).toEqual(['fact', 'chip']);
    expect(chipOutline).toBe('2px solid');
  });

  for (const width of [1440, 390] as const) {
    test(`no axe violations in the hero and the Datasets section at ${width}`, async ({ page }) => {
      await open(page, width, url(union));
      await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('show-items-link').first()).toBeVisible();
      for (const context of ['[data-testid=run-hero]', '#run-section-datasets']) {
        const found = await axeSeriousViolations(page, context);
        expect(found, describeViolations(found)).toEqual([]);
      }
    });
  }

  test('the clamp counts the chips it hides exactly (QC-U8, QC-U44)', async ({ page }) => {
    const expected = { 1440: 6, 1024: 10, 390: 10 } as const;
    for (const width of WIDTHS) {
      await open(page, width, url(many));
      const more = page.getByRole('button', { name: /^\+ \d+ more$/ });
      await expect(more).toHaveText(`+ ${expected[width]} more`);
      const hero = await size(page, '[data-testid=run-hero]');
      expect(hero.h).toBeGreaterThan(150);
      // pressing it shows every chip
      await more.click();
      await expect(page.getByRole('button', { name: 'Show less' })).toBeVisible();
      await page.getByRole('button', { name: 'Show less' }).click();
      // the clamp is stored, so leave it closed for the next width
      const section = await page.locator('#run-section-datasets').boundingBox();
      expect(section).not.toBeNull();
    }
  });
});
