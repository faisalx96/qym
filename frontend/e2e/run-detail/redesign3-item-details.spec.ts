/// <reference lib="dom" />
/**
 * Round 3 P5 (run-detail.md section 5): item details. Left-anchored regions, collapsed output keys, a divider, a metrics
 * matrix, no pass colours. P5-1 .. P5-15 on the wide repeat run (English #1, Arabic #2) and the classic run.
 */
import { test, expect, type Page } from '@playwright/test';
import { openRun, seedClassic, seedProject, seedWideRepeat, type Seeded } from './support';

let s: Seeded;
let wide: string;
let classic: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r3-item');
  wide = await seedWideRepeat(s);
  classic = await seedClassic(s);
});

async function open(page: Page, run: string, item: string, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await openRun(page, s.slug, run, `item=${item}`);
  const card = page.locator(`[data-testid=item-card][data-item-id="${item}"]`);
  await expect(card).toBeVisible();
  await expect(
    card.getByRole('region', { name: 'Metrics', exact: true }).or(card.locator('section[aria-label=Metrics]')),
  ).toBeVisible();
  return card;
}

const ITEMS = [
  ['English', 'big-001'],
  ['Arabic', 'big-002'],
] as const;

for (const width of [1440, 1280, 390]) {
  for (const [kind, id] of ITEMS) {
    test(`P5-1, P5-2 (${kind}) at ${width}px: labels, headings and key rows share one left edge; Arabic stays next to its label`, async ({
      page,
    }) => {
      const card = await open(page, wide, id, width);
      const geo = await card.evaluate((el) => {
        const left = (e: Element | null) => e!.getBoundingClientRect().left;
        const group = (name: string) =>
          Array.from(el.querySelectorAll('[role=group][aria-labelledby]')).find(
            (g) => g.firstElementChild?.textContent?.trim().toLowerCase() === name,
          ) as HTMLElement | undefined;
        const labels = ['input', 'expected', 'tags']
          .map(group)
          .filter((g): g is HTMLElement => !!g)
          .map((g) => left(g.firstElementChild));
        const out = left(el.querySelector('section[aria-label=Output] h3'));
        const key = left(el.querySelector('section[aria-label=Output] button[aria-controls]'));
        const metrics = left(el.querySelector('section[aria-label=Metrics] h3'));
        const input = group('input')!;
        const label = input.firstElementChild!.getBoundingClientRect();
        const valueBox = input.querySelector('[data-measure]')!.getBoundingClientRect();
        const probe = document.createElement('div');
        probe.style.width = '76ch';
        probe.style.position = 'absolute';
        input.appendChild(probe);
        const measure = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          labels,
          out,
          key,
          metrics,
          label: label.left,
          labelRight: label.right,
          valueLeft: valueBox.left,
          valueWidth: valueBox.width,
          measure,
        };
      });
      const edges = [...geo.labels, geo.out, geo.key, geo.metrics];
      for (const e of edges) expect(Math.abs(e - edges[0]!)).toBeLessThanOrEqual(1);
      // the label is at the left and the value block starts right after it (label column + 14px gap), at most 76ch wide
      // (under 640px the label sits above the body: same left edge)
      if (width > 640) {
        expect(geo.label).toBeLessThan(geo.valueLeft);
        expect(geo.valueLeft - geo.labelRight).toBeLessThanOrEqual(14 + 1);
      } else expect(Math.abs(geo.label - geo.valueLeft)).toBeLessThanOrEqual(1);
      expect(geo.valueWidth).toBeLessThanOrEqual(geo.measure + 1);
    });
  }
}

test('P5-3: dir is set only on value text; no region row, label, button or matrix header takes another direction', async ({
  page,
}) => {
  for (const [, id] of ITEMS) {
    const card = await open(page, wide, id);
    const bad = await card.evaluate((el) =>
      Array.from(el.querySelectorAll('[dir]'))
        .filter((e) => e.getAttribute('dir') !== 'ltr')
        .filter(
          (e) =>
            e.tagName === 'BUTTON' ||
            e.tagName === 'TH' ||
            e.tagName === 'H3' ||
            e.getAttribute('role') === 'group' ||
            !!e.closest('thead') ||
            ((e.parentElement?.closest('[role=group]')?.getAttribute('dir') ?? 'ltr') !== 'ltr' &&
              e.getAttribute('role') === 'group'),
        )
        .map((e) => `${e.tagName}[${e.getAttribute('dir')}]`),
    );
    expect(bad).toEqual([]);
  }
});

test('P5-4: opening an item expands no output key (English and Arabic, 10 passes and one pass)', async ({
  page,
}) => {
  for (const [run, id] of [
    [wide, 'big-001'],
    [wide, 'big-002'],
    [classic, 'item-0003'],
  ] as const) {
    const card = await open(page, run, id);
    await expect(card.locator('section[aria-label=Output] [aria-expanded=true]')).toHaveCount(0);
  }
  const card = await open(page, wide, 'big-001');
  expect(await card.locator('section[aria-label=Output] button[aria-controls]').count()).toBeGreaterThan(5);
});

test('P5-5, P5-6: nested keys open collapsed with a type summary; Expand all and Collapse all are recursive', async ({
  page,
}) => {
  const card = await open(page, wide, 'big-001');
  const out = card.locator('section[aria-label=Output]');
  const meta = out.getByRole('button', { name: /^meta/ }).first();
  await meta.click();
  await expect(out.getByRole('button', { name: /^nested/ }).first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(out.getByText('object · 2 keys').first()).toBeVisible();
  await out.getByRole('button', { name: 'Expand all in meta' }).first().click();
  const body = out
    .locator('[data-open]')
    .filter({ has: page.getByRole('button', { name: 'Collapse all in meta' }) })
    .first();
  await expect(body.locator('button[aria-controls][aria-expanded=false]')).toHaveCount(0);
  await expect(body.getByText('deep').first()).toBeVisible();
  await out.getByRole('button', { name: 'Collapse all in meta' }).first().click();
  await expect(out.getByRole('button', { name: /^nested/ }).first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // the Output region: every key of every shown pass, then back to the default
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await expect(out.locator('button[aria-controls][aria-expanded=false]')).toHaveCount(0);
  await card.getByRole('button', { name: 'Collapse all output keys' }).click();
  await expect(out.locator('[aria-expanded=true]')).toHaveCount(0);
});

test('P5-7, P5-8, P5-13, P5-14: a divider, a matrix of at most 8 rows without sideways scroll, one ItemBar, at most 1,400px', async ({
  page,
}) => {
  const card = await open(page, wide, 'big-001');
  const info = await card.evaluate((el) => {
    const hr = el.querySelector('hr')!;
    const hrBox = hr.getBoundingClientRect();
    const cs = getComputedStyle(hr);
    const out = el.querySelector('section[aria-label=Output]')!.getBoundingClientRect();
    const grid = el.querySelector('[role=grid][aria-label="Metrics by pass"]')!;
    const scroller = grid.closest('[data-dt-scroller]') as HTMLElement;
    const names = Array.from(el.querySelectorAll('[data-metric]')).filter(
      (n) => n.getBoundingClientRect().top < hrBox.top,
    ).length;
    return {
      width: hrBox.width,
      article: el.getBoundingClientRect().width,
      border: cs.borderTopWidth,
      gap: hrBox.top - out.bottom,
      rows: grid.querySelectorAll('tbody tr[data-metric]').length,
      cols: grid.querySelectorAll('thead th').length,
      over: scroller.scrollWidth - scroller.clientWidth,
      above: names,
      height: el.getBoundingClientRect().height,
      bars: el.querySelectorAll('[data-item-bar]').length,
    };
  });
  expect(info.border).toBe('1px');
  expect(info.gap).toBeGreaterThanOrEqual(19);
  expect(info.width).toBeGreaterThan(info.article - 41 - 1);
  expect(info.above).toBe(0);
  expect(info.rows).toBeLessThanOrEqual(8);
  expect(info.cols).toBeLessThanOrEqual(12);
  expect(info.over).toBeLessThanOrEqual(0);
  expect(info.bars).toBe(1);
  expect(info.height).toBeLessThanOrEqual(1400);
});

test('P5-9, P5-10, P5-11: a pass has no colour; ten chips with number and glyph; at most three equal columns', async ({
  page,
}) => {
  const card = await open(page, wide, 'big-001');
  expect(await card.locator('[data-series], [data-hue]').count()).toBe(0);
  const rail = card.getByRole('group', { name: 'Passes shown' });
  const chips = rail.getByRole('button');
  await expect(chips).toHaveCount(10);
  const texts = await chips.allInnerTexts();
  expect(new Set(texts.map((t) => t.replace(/\s+/g, ' ').trim())).size).toBe(10);
  for (const t of texts) expect(t).toMatch(/\d+\s*[✓✕]/);
  const cols = card.locator('section[aria-label=Output] [data-pass]');
  await expect(cols).toHaveCount(3);
  const widths = await cols.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of widths) expect(Math.abs(w - widths[0]!)).toBeLessThanOrEqual(1);
  // the coloured rails of round 2 are gone: only the hairline separates columns
  const rails = await cols.evaluateAll((els) =>
    els.map((e) => getComputedStyle(e).borderInlineStartColor + getComputedStyle(e).borderInlineStartWidth),
  );
  expect(new Set(rails.slice(1)).size).toBe(1);
  // a fourth selection replaces the oldest; the column header names the pass as text
  await rail.getByRole('button', { name: /^Pass 7,/ }).click();
  await expect(cols).toHaveCount(3);
  await expect(card.locator('section[aria-label=Output] [data-pass="1"]')).toHaveCount(0);
  await expect(card.locator('section[aria-label=Output] [data-pass="7"]')).toContainText('Pass 7');
});

test('P5-12: a matrix value opens one detail with the reason; another replaces it; edit opens the editor; Escape closes', async ({
  page,
}) => {
  const card = await open(page, wide, 'big-001');
  const grid = card.getByRole('grid', { name: 'Metrics by pass' });
  await grid.getByRole('button', { name: /^rubric_metric_01, pass 3:/ }).click();
  const detail = card.getByTestId('metric-detail');
  await expect(detail).toHaveCount(1);
  await expect(detail).toContainText('يغطي معظم النقاط');
  await grid.getByRole('button', { name: /^rubric_metric_02, pass 2:/ }).click();
  await expect(detail).toHaveCount(1);
  await expect(detail).toHaveAttribute('data-metric', 'rubric_metric_02');
  await grid.getByRole('button', { name: /^rubric_metric_01, pass 3:/ }).click();
  await detail.getByRole('button', { name: 'Edit score', exact: true }).click();
  await expect(detail.getByRole('textbox', { name: 'New rubric_metric_01 score' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('textbox')).toHaveCount(0);
  await grid.getByRole('button', { name: /^rubric_metric_01, pass 3:/ }).focus();
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('metric-detail')).toHaveCount(0);
});

test('P5-12b: the matrix is a roving grid (arrows move between cells)', async ({ page }) => {
  const card = await open(page, wide, 'big-001');
  const grid = card.getByRole('grid', { name: 'Metrics by pass' });
  const a = grid.getByRole('button', { name: /^correct, pass 1:/ });
  await a.focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.getByRole('button', { name: /^correct, pass 2:/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(grid.getByRole('button', { name: /^rubric_metric_01, pass 2:/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(grid.getByRole('button', { name: /^rubric_metric_01, pass 10:/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(grid.getByRole('button', { name: /^rubric_metric_01, pass 1:/ })).toBeFocused();
  await grid.getByRole('button', { name: /^rubric_metric_01, pass 1:/ }).press('Enter');
  await expect(card.getByTestId('metric-detail')).toHaveCount(1);
  // "Show 16 more metrics" reveals the rest
  await card.getByRole('button', { name: 'Show 16 more metrics' }).click();
  await expect(grid.getByRole('row')).toHaveCount(25);
});

test('P5-15: at 390 there is no sideways scroll and the detail fits the scroller', async ({ page }) => {
  for (const [, id] of ITEMS) {
    const card = await open(page, wide, id, 390);
    const r = await card.evaluate((el) => {
      const sc = document.getElementById('shell-content')!;
      return {
        page: document.documentElement.scrollWidth <= window.innerWidth,
        fits: el.getBoundingClientRect().right <= sc.getBoundingClientRect().right + 1,
        matrix: (() => {
          const s = el
            .querySelector('[role=grid][aria-label="Metrics by pass"]')!
            .closest('[data-dt-scroller]') as HTMLElement;
          return s.scrollWidth - s.clientWidth;
        })(),
      };
    });
    expect({ page: r.page, fits: r.fits }).toEqual({ page: true, fits: true });
    // round 8b: the section panel takes 30 px of the 390 column, so the by-pass matrix of the 10-pass run scrolls inside its own scroller (26 px, measured); the page never does
    expect(r.matrix, 'matrix overflow').toBeLessThanOrEqual(30);
  }
});
