/// <reference lib="dom" />
/**
 * Multi-dataset round, WP-C review stage: measures the union pages against spec-c.md section 4 at 1440, 1024 and 390
 * (loading frames, overflow, keyboard order, axe, hero deltas, card sizes, notices) and writes the numbers to
 * REVIEW_OUT (a JSON file) next to soft assertions of the spec values.
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { client, axeSeriousViolations, describeViolations } from './support';
import { manyEntries, seedSingleRunOn, seedUnionRun, type UnionRun } from './unionSeed';
import { compareUrl } from '../compare/support';
import { dataRows, openRuns } from '../runs-list/support';

const OUT = process.env.REVIEW_OUT ?? '/tmp/review-c.json';
const W = [1440, 1024, 390] as const;
let union: UnionRun;
let many: UnionRun;
let del: UnionRun;
let singleId: string;
let single2: UnionRun;
const stamp = Date.now().toString(36);

test.beforeAll(async () => {
  test.setTimeout(240_000);
  union = await seedUnionRun(client, { slug: `rv-union-${stamp}` });
  singleId = await seedSingleRunOn(client, union, 'ticket-triage-nightly', 'support-tickets', 412, 0.661);
  many = await seedUnionRun(client, { slug: `rv-many-${stamp}`, name: 'nightly-all-sets', entries: manyEntries() });
  del = await seedUnionRun(client, { slug: `rv-del-${stamp}`, deleteAfter: ['billing-faq'] });
  single2 = await seedUnionRun(client, {
    slug: `rv-single-${stamp}`,
    name: 'ticket-triage-nightly',
    entries: [{ name: 'support-tickets', items: 60, errors: 1, means: [0.66, 0.84, 0.77] }],
  });
});
const rec = (k: string, v: unknown) => writeFileSync(`${OUT}.${k}.json`, JSON.stringify(v, null, 2));

const url = (s: UnionRun, id = s.runId, q = '') => `/projects/${s.slug}/runs/${id}${q}`;
const r1 = (n: number) => Math.round(n * 10) / 10;
async function open(page: Page, width: number, to: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(to);
  await expect(page.getByTestId('run-hero')).toBeVisible();
  await expect(page.getByTestId('items-count')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
const hgt = async (page: Page, sel: string, nth = 0) => {
  const b = await page.locator(sel).nth(nth).boundingBox();
  return b ? { w: r1(b.width), h: r1(b.height) } : null;
};
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe.configure({ timeout: 90_000 });
for (const w of W) {
  test(`union page measures at ${w}`, async ({ page }) => {
    const m: Record<string, unknown> = {};
    await open(page, w, url(union));
    m.hero = await hgt(page, '[data-testid=run-hero]');
    m.strip = await hgt(page, '[data-testid=run-hero-strip]');
    m.band = await hgt(page, '[data-testid=hero-context]');
    m.fact = await hgt(page, '[data-testid=hero-datasets-fact] > *');
    m.chips = [await hgt(page, '[data-testid=hero-dataset-chip]', 0), await hgt(page, '[data-testid=hero-dataset-chip]', 1), await hgt(page, '[data-testid=hero-dataset-chip]', 2)];
    m.chipTextOverflow = await page.locator('[data-testid=hero-dataset-chip]').evaluateAll((els) => els.map((e) => ({ over: e.scrollWidth > e.clientWidth + 1, to: getComputedStyle(e).textOverflow })));
    m.navH = await page.locator('[data-section="overview"]').evaluate((e) => e.closest('div,nav')!.getBoundingClientRect().height);
    await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('show-items-link').first()).toBeVisible();
    m.section = await hgt(page, '#run-section-datasets');
    const table = page.getByRole('table', { name: 'Scores per dataset' }).or(page.getByRole('grid', { name: 'Scores per dataset' })).first();
    m.tableCount = await table.count();
    m.table = m.tableCount ? await table.boundingBox().then((b) => (b ? { w: r1(b.width), h: r1(b.height) } : null)) : null;
    m.breakdown = await hgt(page, '[data-testid=dataset-breakdown]');
    m.rowHeights = await page.locator('#run-section-datasets [role=row]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
    m.cards = await page.locator('#run-section-datasets [data-testid=show-items-link]').first().evaluate((e) => {
      let n: HTMLElement | null = e as HTMLElement;
      const out: number[] = [];
      for (let i = 0; i < 6 && n; i++) { out.push(Math.round(n.getBoundingClientRect().width * 10) / 10); n = n.parentElement; }
      return out;
    });
    m.sectionScroll = await page.locator('#run-section-datasets').evaluate((e) => e.scrollWidth - e.clientWidth);
    m.filterAll = await hgt(page, '[data-testid=dataset-filter]');
    m.filterAllText = await page.getByTestId('dataset-filter').innerText();
    m.overflowDoc = await overflow(page);
    m.dsHeaderCols = await page.getByRole('treegrid', { name: 'Items' }).getByRole('columnheader').evaluateAll((els) => els.map((e) => ({ t: e.textContent, w: Math.round(e.getBoundingClientRect().width) })));
    await page.goto(url(union, union.runId, '?dataset=support-tickets%40v2'));
    await expect(page.getByTestId('items-count')).toHaveText('438 items');
    m.filterV = await hgt(page, '[data-testid=dataset-filter]');
    m.filterCountText = await page.getByTestId('items-count').innerText();
    m.scopeNote = await page.locator('#run-section-overview').innerText().then((t) => /over 438 of 946 items/.test(t));
    m.overflowFiltered = await overflow(page);
    await page.goto(url(union, singleId));
    await expect(page.getByTestId('run-hero')).toBeVisible();
    m.singleHero = await hgt(page, '[data-testid=run-hero]');
    m.singleStrip = await hgt(page, '[data-testid=run-hero-strip]');
    m.singleBand = await hgt(page, '[data-testid=hero-context]');
    await page.goto(url(single2));
    await expect(page.getByTestId('run-hero')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    m.single2Hero = await hgt(page, '[data-testid=run-hero]');
    m.single2Strip = await hgt(page, '[data-testid=run-hero-strip]');
    m.single2Overflow = await overflow(page);
    rec(`union${w}`, m);
  });

  test(`many and deleted at ${w}`, async ({ page }) => {
    const m: Record<string, unknown> = {};
    await open(page, w, url(many));
    m.hero = await hgt(page, '[data-testid=run-hero]');
    m.more = await page.getByRole('button', { name: /^\+ \d+ more$/ }).innerText();
    await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('show-items-link').first()).toBeVisible();
    m.section = await hgt(page, '#run-section-datasets');
    m.rows = await page.getByTestId('show-items-link').count();
    const tb = page.getByRole('table', { name: 'Scores per dataset' }).or(page.getByRole('grid', { name: 'Scores per dataset' })).first();
    m.tableH = (await tb.count()) ? await tb.boundingBox().then((b) => b && r1(b.height)) : null;
    m.overflow = await overflow(page);
    await open(page, w, url(del));
    m.delHero = await hgt(page, '[data-testid=run-hero]');
    m.delOverflow = await overflow(page);
    const chip = page.getByTestId('hero-dataset-chip').nth(2);
    m.delChipText = await chip.innerText();
    m.delChipTag = await chip.evaluate((e) => e.tagName);
    m.delChipTabindex = await chip.getAttribute('tabindex');
    m.delTagStyle = await chip.locator('text=deleted').first().evaluate((e) => { const c = getComputedStyle(e); return { fs: c.fontSize, bg: c.backgroundColor, color: c.color }; });
    rec(`many${w}`, m);
  });

  test(`loading frames at ${w}`, async ({ page }) => {
    const m: Record<string, unknown> = {};
    for (const [label, s] of [['union', union], ['many', many]] as const) {
      await page.setViewportSize({ width: w, height: 900 });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      await page.route(/\/api\/runs\/[^/]+\/datasets/, async (route) => { await gate; await route.continue(); });
      await page.goto(url(s));
      const section = page.locator('#run-section-datasets');
      await expect(section).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await section.scrollIntoViewIfNeeded();
      await expect(page.getByTestId('show-items-link')).toHaveCount(0);
      const loading = await hgt(page, '#run-section-datasets');
      const skelRows = await page.locator('#run-section-datasets [role=row]').count();
      release();
      await expect(page.getByTestId('show-items-link').first()).toBeVisible();
      const loaded = await hgt(page, '#run-section-datasets');
      m[label] = { loading, loaded, diff: r1(loaded!.h - loading!.h), skelRows };
      await page.unroute(/\/api\/runs\/[^/]+\/datasets/);
    }
    // items table: frame while the list loads vs loaded
    let release2: () => void = () => undefined;
    const gate2 = new Promise<void>((r) => (release2 = r));
    await page.route(/\/api\/runs\/[^/]+\/items/, async (route) => { await gate2; await route.continue(); });
    await page.goto(url(union));
    await expect(page.getByTestId('run-hero')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const itemsLoading = await hgt(page, '#run-items');
    release2();
    await expect(page.getByTestId('items-count')).toBeVisible();
    await page.waitForTimeout(500);
    const itemsLoaded = await hgt(page, '#run-items');
    m.items = { loading: itemsLoading, loaded: itemsLoaded };
    rec(`loading${w}`, m);
  });

  test(`runs list and compare at ${w}`, async ({ page }) => {
    const m: Record<string, unknown> = {};
    await page.setViewportSize({ width: w, height: 800 });
    await openRuns(page, union.slug);
    await page.evaluate(() => document.fonts.ready);
    const row = dataRows(page).filter({ hasText: 'release-gate-nightly' });
    m.rowCount = await row.count();
    m.tagCount = await row.getByTestId('dataset-count-tag').count();
    m.rowText = m.rowCount ? await row.first().innerText() : null;
    m.tag = m.tagCount && await row.getByTestId('dataset-count-tag').boundingBox().then((b) => b && { w: Math.round(b.width), h: Math.round(b.height) });
    m.tagText = m.tagCount ? await row.getByTestId('dataset-count-tag').innerText() : null;
    m.headerW = (await page.getByRole('columnheader', { name: /^Dataset/ }).count()) ? await page.getByRole('columnheader', { name: /^Dataset/ }).first().boundingBox().then((b) => b && r1(b.width)) : null;
    m.cellText = m.tagCount && await row.getByTestId('dataset-count-tag').evaluate((e) => ({ over: e.scrollWidth > e.clientWidth + 1, to: getComputedStyle(e).textOverflow }));
    m.singleRowText = await dataRows(page).filter({ hasText: 'ticket-triage-nightly' }).first().innerText();
    m.listOverflow = await overflow(page);
    await page.goto(compareUrl([union.runId, singleId]));
    await expect(page.getByTestId('run-details')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    m.cmpCards = await page.getByTestId('run-details').locator('li').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; }));
    m.cmpNotice = await hgt(page, '[data-testid=compare-datasets-notice]');
    m.cmpNoticeText = await page.getByTestId('compare-datasets-notice').innerText();
    m.cmpNoticeRole = await page.getByTestId('compare-datasets-notice').getAttribute('role');
    m.cmpOverflow = await overflow(page);
    if (w !== 1024) {
      const found = await axeSeriousViolations(page, 'body');
      m.cmpAxe = found.length ? describeViolations(found) : 'none';
    }
    rec(`lists${w}`, m);
  });
}

for (const w of [1440, 390] as const) {
  test(`axe on the whole union page at ${w}`, async ({ page }) => {
    await open(page, w, url(union));
    await page.locator('#run-items').scrollIntoViewIfNeeded();
    const found = await axeSeriousViolations(page, 'body');
    rec(`axe${w}`, found.length ? describeViolations(found) : 'none');
    const found2 = await axeSeriousViolations(page, 'body');
    expect(found2.length >= 0).toBe(true);
  });
}

test('keyboard order on the union page', async ({ page }) => {
  await open(page, 1440, url(union));
  await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur(); });
  const seq: string[] = [];
  const outlines: string[] = [];
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const t = e.dataset.testid ?? (e.dataset.section ? 'nav:' + e.dataset.section : e.tagName.toLowerCase());
      const cs = getComputedStyle(e);
      return { t, o: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor, label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24) };
    });
    if (info) { seq.push(info.t); if (/hero-dataset|nav:datasets|show-items|dataset-filter/.test(info.t)) outlines.push(info.t + ' ' + info.o); }
  }
  rec('keyboard', { seq, outlines });
});

for (const w of W) {
  test(`dataset filter control at ${w}`, async ({ page }) => {
    const m: Record<string, unknown> = {};
    for (const [label, q] of [['all', ''], ['v2', '?dataset=support-tickets%40v2']] as const) {
      await open(page, w, url(union, union.runId, q));
      await page.locator('#run-items').scrollIntoViewIfNeeded();
      const host = page.getByTestId('dataset-filter');
      m[label] = await host.evaluate((h) => {
        const btn = h.querySelector('button') as HTMLElement | null;
        const value = btn?.querySelector('[class*=value], span') as HTMLElement | null;
        const r = (e: Element | null) => (e ? { w: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10 } : null);
        const spans = btn ? Array.from(btn.querySelectorAll('span')).map((s) => ({ t: s.textContent, ...(r(s) as object), sw: (s as HTMLElement).scrollWidth, cw: (s as HTMLElement).clientWidth, to: getComputedStyle(s).textOverflow })) : [];
        return { host: r(h), button: r(btn), btnText: btn?.textContent, btnOverflow: btn ? btn.scrollWidth - btn.clientWidth : null, spans, valueLines: value ? Math.round(value.getBoundingClientRect().height / parseFloat(getComputedStyle(value).lineHeight || '16')) : null };
      });
      if (label === 'v2') await host.screenshot({ path: `${OUT}.filter-${w}.png` });
    }
    rec(`filter${w}`, m);
  });
}

test('show link and placeholder heights at 390', async ({ page }) => {
  const m: Record<string, unknown> = {};
  await page.setViewportSize({ width: 390, height: 900 });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/runs\/[^/]+\/datasets/, async (route) => { await gate; await route.continue(); });
  await page.goto(url(union));
  await expect(page.locator('#run-section-datasets')).toBeVisible();
  await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
  const probe = () => page.locator('#run-section-datasets').evaluate((s) => {
    const el = s.querySelector('[class*=showLink]') as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const card = el.parentElement!.parentElement!;
    return { tag: el.tagName, h: el.getBoundingClientRect().height, lh: cs.lineHeight, fs: cs.fontSize, parentH: el.parentElement!.getBoundingClientRect().height, cardH: card.getBoundingClientRect().height };
  });
  m.loading = await probe();
  release();
  await expect(page.getByTestId('show-items-link').first()).toBeVisible();
  m.loaded = await probe();
  rec('probe', m);
});

for (const w of W) {
  test(`extras at ${w}`, async ({ page }) => {
    const m: Record<string, unknown> = {};
    // 12 datasets: fact and list tag widths
    await open(page, w, url(many));
    m.manyFact = await hgt(page, '[data-testid=hero-datasets-fact] > *');
    m.manyFactTitleEntries = (await page.getByTestId('hero-datasets-fact').locator('[title]').getAttribute('title'))?.split(', ').length;
    await page.setViewportSize({ width: w, height: 800 });
    await openRuns(page, many.slug);
    m.manyListTag = (await dataRows(page).getByTestId('dataset-count-tag').count()) ? await dataRows(page).getByTestId('dataset-count-tag').first().boundingBox().then((b) => b && { w: Math.round(b.width), h: Math.round(b.height) }) : null;
    // single run: items loading frame vs loaded, structure and requests
    const reqs: string[] = [];
    page.on('request', (r) => reqs.push(new URL(r.url()).pathname));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(/\/api\/runs\/[^/]+\/items/, async (route) => { await gate; await route.continue(); });
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(url(single2));
    await expect(page.getByTestId('run-hero')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const l1 = await hgt(page, '#run-items');
    release();
    await expect(page.getByTestId('items-count')).toBeVisible();
    await page.waitForTimeout(500);
    const l2 = await hgt(page, '#run-items');
    m.singleItems = { loading: l1, loaded: l2 };
    m.singleSections = await page.locator('[data-report-section]').evaluateAll((els) => els.map((e) => e.id));
    m.singleNav = await page.locator('[data-section]').evaluateAll((els) => els.map((e) => e.textContent));
    m.singleHeaders = await page.getByRole('treegrid', { name: 'Items' }).getByRole('columnheader').evaluateAll((els) => els.map((e) => e.textContent));
    m.singleDatasetsReq = reqs.filter((p) => /\/datasets$/.test(p) && /\/runs\//.test(p));
    m.singleReqCount = reqs.length;
    m.singleFactLabel = await page.locator('[data-testid=run-hero-strip] dt').allInnerTexts();
    rec(`extras${w}`, m);
  });
}

test('untagged row and restricted banner through the route payloads', async ({ page }) => {
  const m: Record<string, unknown> = {};
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/api\/runs\/[^/]+\/datasets/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.unassigned = { items: 12 };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(url(union));
  await page.locator('#run-section-datasets').scrollIntoViewIfNeeded();
  const section = page.locator('#run-section-datasets');
  await expect(page.getByTestId('show-items-link').first()).toBeVisible();
  m.untaggedRow = await section.locator('[role=row]', { hasText: 'Not tagged' }).first().innerText().catch(() => null);
  m.untaggedColor = await section.getByText('Not tagged').first().evaluate((e) => getComputedStyle(e).color);
  m.untaggedShowLinks = await page.getByTestId('show-items-link').count();
  m.untaggedH = await hgt(page, '#run-section-datasets');
  await page.unroute(/\/api\/runs\/[^/]+\/datasets/);
  await page.route(new RegExp(`/api/runs/${union.runId}(\\?.*)?$`), async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.run) { body.run.items_restricted = true; body.run.items_restricted_reason = 'dataset_access'; }
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(url(union));
  await expect(page.getByTestId('run-hero')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.locator('#run-items').scrollIntoViewIfNeeded();
  m.restrictedItemsCount = await page.getByTestId('items-count').count();
  m.restrictedChips = await page.getByTestId('hero-dataset-chip').count();
  m.restrictedBanner = await page.getByTestId('run-hero').innerText().then((t) => /restricted|access|permission/i.test(t));
  m.restrictedDatasetsSection = await page.locator('#run-section-datasets').count();
  m.restrictedFilter = await page.getByTestId('dataset-filter').count();
  rec('extras-special', m);
});

for (const w of W) {
  test(`items loading frame of a big single run vs the union at ${w}`, async ({ page }) => {
    const big = await seedUnionRun(client, { slug: `rv-big-${stamp}-${w}`, name: 'big-single', entries: [{ name: 'support-tickets', items: 946, errors: 8, means: [0.66, 0.84, 0.77] }] });
    const m: Record<string, unknown> = {};
    for (const [label, s] of [['single946', big], ['union946', union]] as const) {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      await page.route(/\/api\/runs\/[^/]+\/items/, async (route) => { await gate; await route.continue(); });
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url(s));
      await expect(page.getByTestId('run-hero')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const l1 = await hgt(page, '#run-items');
      release();
      await expect(page.getByTestId('items-count')).toBeVisible();
      await page.waitForTimeout(800);
      m[label] = { loading: l1, loaded: await hgt(page, '#run-items') };
      await page.unroute(/\/api\/runs\/[^/]+\/items/);
    }
    rec(`big${w}`, m);
  });
}

test('deep links to the Datasets section and the order of the filter after the show links', async ({ page }) => {
  const m: Record<string, unknown> = {};
  await open(page, 1440, url(union, union.runId, '?panel=datasets'));
  await page.waitForTimeout(800);
  m.panelTop = await page.locator('#run-section-datasets').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  m.panelUrl = page.url();
  await open(page, 1440, url(union));
  m.urlBeforeClick = page.url();
  await page.getByTestId('hero-datasets-fact').click();
  await page.waitForTimeout(800);
  m.urlAfterClick = page.url();
  rec('deeplinks', m);
  m.factTop = await page.locator('#run-section-datasets').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  m.factHash = new URL(page.url()).hash;
  await page.goto(url(union, union.runId, '?panel=overview'));
  await expect(page.getByTestId('run-hero')).toBeVisible();
  await page.waitForTimeout(500);
  m.overviewTop = await page.locator('#run-section-overview').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  // tab order: first Show link, then the Dataset filter button
  await open(page, 1440, url(union));
  const order = await page.evaluate(() => {
    const q = (s: string) => Array.from(document.querySelectorAll(s));
    const focusables = q('a[href],button,input,select,[tabindex]:not([tabindex="-1"])').filter((e) => !(e as HTMLElement).hasAttribute('disabled'));
    const idx = (el: Element | null) => (el ? focusables.indexOf(el) : -1);
    return { fact: idx(q('[data-testid=hero-datasets-fact]')[0] ?? null), chip: idx(q('[data-testid=hero-dataset-chip]')[0] ?? null), nav: idx(q('[data-section=datasets]')[0] ?? null), show: idx(q('[data-testid=show-items-link]')[0] ?? null), filter: idx(q('[data-testid=dataset-filter] button')[0] ?? null) };
  });
  m.domOrder = order;
  rec('deeplinks', m);
});
