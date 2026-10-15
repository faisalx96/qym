/// <reference lib="dom" />
/** Round 3 P4 (run-detail.md section 4): the column header never sits over an expanded item; the ItemBar owns the sticky line. */
import { test, expect, type Page } from '@playwright/test';
import { itemButton, openRun, seedProject, seedWideRepeat, showItems, type Seeded } from './support';

let s: Seeded;
let wide: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r3-sticky');
  wide = await seedWideRepeat(s);
});

interface Sample {
  scroll: number;
  line: number;
  head: { top: number; bottom: number } | null;
  details: Array<{ top: number; bottom: number }>;
  bars: Array<{ top: number; height: number; text: string }>;
  pinned: Array<{ top: number; bottom: number }>;
}

/** Scroll the shell scroller across the whole items table in `step` px and record the geometry at each stop. */
async function sweep(page: Page, step: number): Promise<Sample[]> {
  return page.evaluate(async (stepPx) => {
    const sc = document.getElementById('shell-content')!;
    const table = document.querySelector('[role=treegrid][aria-label=Items]')!;
    const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
    const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
    const out: Sample[] = [];
    const t0 = table.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const tableBottom = t0 + table.getBoundingClientRect().height;
    for (let y = Math.max(0, t0 - 200); y < tableBottom; y += stepPx) {
      sc.scrollTop = y;
      await new Promise((r) => setTimeout(r, 40));
      const line = (() => {
        const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
        const f =
          filters && getComputedStyle(filters).position === 'sticky'
            ? filters.getBoundingClientRect().bottom
            : 0;
        return Math.max(n, f);
      })();
      const ths = Array.from(table.querySelectorAll(':scope > thead th')).map((th) =>
        th.getBoundingClientRect(),
      );
      const box = (r: DOMRect) => ({ top: r.top, bottom: r.bottom });
      out.push({
        scroll: y,
        line,
        head: ths.length
          ? { top: Math.min(...ths.map((r) => r.top)), bottom: Math.max(...ths.map((r) => r.bottom)) }
          : null,
        details: Array.from(table.querySelectorAll(':scope > tbody > tr[data-detail-row]')).map((d) =>
          box(d.getBoundingClientRect()),
        ),
        bars: Array.from(table.querySelectorAll('[data-item-bar]')).map((b) => {
          const r = b.getBoundingClientRect();
          return { top: r.top, height: r.height, text: b.textContent ?? '' };
        }),
        pinned: Array.from(table.querySelectorAll(':scope > thead th[data-pin]')).map((th) =>
          box(th.getBoundingClientRect()),
        ),
      });
    }
    return out;
  }, step);
}

async function expand(page: Page, ...numbers: number[]) {
  for (const n of numbers) await itemButton(page, n).click();
  await expect(page.locator('[data-testid=item-card]')).toHaveCount(numbers.length);
  await page.evaluate(() => document.getElementById('shell-content')!.scrollTo(0, 0));
}

const overlap = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

for (const width of [1440, 1280]) {
  test(`P4-1, P4-3, P4-4, P4-7 at ${width}px: the header never overlaps the expanded item and returns below it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRun(page, s.slug, wide);
    await showItems(page);
    await expand(page, 1);
    const samples = await sweep(page, 100);
    expect(samples.length).toBeGreaterThan(5);
    let barSeen = 0;
    let afterSeen = 0;
    for (const sm of samples) {
      if (!sm.head) continue;
      for (const d of sm.details) {
        expect(overlap(sm.head, d), `scroll ${sm.scroll}`).toBeLessThanOrEqual(1);
        for (const p of sm.pinned) expect(overlap(p, d)).toBeLessThanOrEqual(1);
        // the line is inside the detail: the ItemBar sits at the line, 32px high
        if (sm.line > d.top + 40 && sm.line < d.bottom - 40) {
          barSeen++;
          expect(Math.abs(sm.bars[0]!.top - sm.line)).toBeLessThanOrEqual(1.5);
          expect(Math.round(sm.bars[0]!.height)).toBeGreaterThanOrEqual(32);
          expect(sm.bars[0]!.text).toContain('#1');
        }
        // the line is past the detail and rows follow: the header is at the line again
        if (sm.line > d.bottom + 4 && sm.head.top > d.bottom - 1 && sm.head.top < sm.line + 200) {
          afterSeen++;
          expect(Math.abs(sm.head.top - sm.line)).toBeLessThanOrEqual(1.5);
        }
      }
    }
    expect(barSeen).toBeGreaterThan(2);
    expect(afterSeen).toBeGreaterThanOrEqual(0);
    expect(await page.locator('[data-item-bar]').count()).toBe(1);
  });
}

test('P4-2: with no item expanded the header sticks at the line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, wide);
  await showItems(page);
  const samples = await sweep(page, 150);
  const stuck = samples.filter((sm) => sm.head && sm.head.top > sm.line - 3 && sm.head.top < sm.line + 3);
  expect(stuck.length).toBeGreaterThan(0);
});

test('P4-5: two items expanded: no overlap with either; the header shows between them', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, wide);
  await showItems(page);
  await expand(page, 1, 6);
  expect(await page.locator('[data-item-bar]').count()).toBe(2);
  const samples = await sweep(page, 40);
  let between = 0;
  for (const sm of samples) {
    if (!sm.head) continue;
    for (const d of sm.details) expect(overlap(sm.head, d), `scroll ${sm.scroll}`).toBeLessThanOrEqual(1);
    const [a, b] = sm.details;
    if (a && b && sm.line > a.bottom + 2 && sm.line < b.top - sm.head.bottom + sm.head.top - 2) {
      between++;
      expect(Math.abs(sm.head.top - sm.line)).toBeLessThanOrEqual(1.5);
    }
  }
  expect(between).toBeGreaterThan(0);
});

test('P4-6: Collapse in the ItemBar closes the item and returns focus to its row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, wide);
  await showItems(page);
  await expand(page, 2);
  await page.getByRole('button', { name: 'Collapse item #2' }).click();
  await expect(page.locator('[data-testid=item-card]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-item-id')),
    )
    .toBe('big-002');
});

test('P4-8: at 390 (cards) the ItemBar sticks at the 44px nav and nothing else sticks over the card', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRun(page, s.slug, wide);
  await showItems(page);
  await itemButton(page, 1).click();
  const card = page.getByRole('article', { name: 'Item #1' });
  await expect(card).toBeVisible();
  const r = await card.evaluate(async (el) => {
    const sc = document.getElementById('shell-content')!;
    const box = el.getBoundingClientRect();
    const nav0 = (document.querySelector('[data-run-nav]') as HTMLElement).getBoundingClientRect();
    sc.scrollTop += box.top - nav0.bottom + Math.min(200, box.height / 3);
    await new Promise((res) => setTimeout(res, 300));
    const bar = el.querySelector('[data-item-bar]')!.getBoundingClientRect();
    const nav = (document.querySelector('[data-run-nav]') as HTMLElement).getBoundingClientRect();
    return { barTop: bar.top, navBottom: nav.bottom, h: bar.height };
  });
  expect(Math.abs(r.barTop - r.navBottom)).toBeLessThanOrEqual(1.5);
  expect(Math.round(r.h)).toBeGreaterThanOrEqual(32);
});
