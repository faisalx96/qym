/// <reference lib="dom" />
/**
 * Redesign round 7, D3 (docs/internal/ui-migration/redesign7/qa.md): table boundaries are visible only inside the table.
 * The items table with an expanded item: no overlay, the pinned cells draw the one line and it stops above the open item,
 * nothing is stacked over the item's text, and the sticky header and item bar stay inside the card.
 * Criteria D3-1 to D3-7 at 1440 and 1024 (390 is cards).
 */
import { test, expect, type Page } from '@playwright/test';
import { coveredText, edgeReport, LINE_END, LINE_START } from '../edges';
import { itemButton, openRun, seedClassic, seedProject, showItems, type Seeded } from './support';

const TABLE = '#run-items [data-testid=data-table]';
let s: Seeded;
let runId: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r7-edges');
  runId = await seedClassic(s, { items: 600, traced: 5, runName: 'r7-edges' });
});

const scrollShell = (page: Page, top: number | 'end') =>
  page.evaluate(async (y) => {
    const sc = document.getElementById('shell-content')!;
    sc.scrollTop = y === 'end' ? sc.scrollHeight : y;
    await new Promise((r) => setTimeout(r, 120));
  }, top);

for (const width of [1440, 1024] as const) {
  test.describe(`D3 at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('D3-1 to D3-4: no overlay, one line that stops above the open item, nothing stacked over its text', async ({
      page,
    }) => {
      await openRun(page, s.slug, runId);
      await showItems(page);
      await expect(page.locator(`${TABLE} td[data-pin-edge]`).first()).toBeVisible();

      const check = async (state: string, open: boolean): Promise<void> => {
        const rep = await edgeReport(page, TABLE);
        expect(rep.overlays, `${state}: overlay elements (D3-1, D3-4)`).toBe(0);
        expect(
          await page.locator('#run-items [data-edge]').count(),
          `${state}: [data-edge] in #run-items`,
        ).toBe(0);
        // D3-1 / Q1-4: the pinned cells draw the line, in --border-strong, 1px, on the inner side
        for (const c of rep.cells) {
          const want = c.edge === 'start' ? LINE_START : LINE_END;
          if (c.rail) expect(c.shadow, `${state}: ${c.edge} rail row`).toContain(want);
          else expect(c.shadow, `${state}: ${c.edge} ${c.tag}`).toBe(want);
          // D3-2: no pinned-edge element is taller than a row (the old cue was as tall as the 500-row body)
          expect(c.bottom - c.top, `${state}: pinned-edge cell height`).toBeLessThanOrEqual(80);
        }
        expect(await coveredText(page, TABLE), `${state}: covered text (D3-1)`).toEqual([]);
        // D3-2: the only gap in the line is the open item's detail row
        const detail = rep.detailRows.filter((d) => !d.strip);
        for (const side of ['start', 'end'] as const) {
          // round 8b: below 8 px is the virtualizer's end spacer (5.1 px at 1024 once the section panel adds its bottom padding), not a row without the line
          const gaps = rep.gaps[side].filter((g) => g > 8);
          if (open) {
            expect(gaps.length, `${state}: ${side} gaps ${JSON.stringify(gaps)}`).toBe(detail.length);
            expect(
              Math.abs(gaps[0]! - detail[0]!.height),
              `${state}: ${side} gap = open item`,
            ).toBeLessThanOrEqual(1);
          } else {
            expect(gaps, `${state}: ${side} gaps`).toEqual([]);
          }
        }
        // D3-3: at the boundary's x inside the detail, the element stacked on top is the detail's own
        if (open) {
          const hits = await page.evaluate((sel) => {
            const card = document.querySelector(sel)!;
            const detailRow = card.querySelector('tr[data-detail-row]')!.getBoundingClientRect();
            // the boundary of the items table itself (a table nested in the detail draws its own)
            const edges = Array.from(card.querySelectorAll('thead [data-pin-edge]'))
              .filter((e) => !e.closest('tr[data-detail-row]'))
              .map((e) => e.getBoundingClientRect());
            const xs = edges.map((r) => r.right).concat(edges.map((r) => r.left));
            const bad: string[] = [];
            for (const x of xs)
              for (let i = 1; i <= 5; i++) {
                const y = Math.min(innerHeight - 2, Math.max(2, detailRow.top + (detailRow.height * i) / 6));
                if (y < detailRow.top || y > detailRow.bottom) continue;
                for (const el of document.elementsFromPoint(x, y)) {
                  const cs = getComputedStyle(el);
                  // (a row's flat tint is a gradient of one colour; a fade has a direction)
                  const nestedCell = el.hasAttribute('data-pin-edge') && el.closest('tr[data-detail-row]');
                  if (
                    (el.hasAttribute('data-pin-edge') && !nestedCell) ||
                    el.hasAttribute('data-edge') ||
                    /linear-gradient\((to |-?[\d.]+deg)/.test(cs.backgroundImage)
                  )
                    bad.push(`${el.tagName}@${Math.round(x)},${Math.round(y)}`);
                }
              }
            return bad;
          }, TABLE);
          expect(hits, `${state}: elements stacked at the boundary inside the detail`).toEqual([]);
        }
      };

      await check('rest', false);
      await itemButton(page, 2).click();
      await expect(page.locator(`${TABLE} [data-testid=item-card]`)).toHaveCount(1);
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      );
      await check('item open', true);
      await scrollShell(
        page,
        (await page.evaluate(() => document.getElementById('shell-content')!.scrollTop)) + 260,
      );
      await check('scrolled 260 px', true);
      await scrollShell(page, 'end');
      await check('scrolled to the end', true);
    });

    test('D3-5 to D3-7: the sticky header and the item bar stay inside the card; nothing of the table lies outside it', async ({
      page,
    }) => {
      await openRun(page, s.slug, runId);
      await showItems(page);
      await itemButton(page, 2).click();
      await expect(page.locator(`${TABLE} [data-testid=item-card]`)).toHaveCount(1);
      const sweep = (): Promise<
        Array<{
          line: number;
          stuck: boolean;
          lineClear: boolean;
          headOverDetail: number;
          head: { top: number; left: number } | null;
          bar: { top: number; left: number; right: number } | null;
          card: { left: number; right: number };
          toolbarOverlap: number;
          footerOverlap: number;
        }>
      > =>
        page.evaluate(async () => {
          const sc = document.getElementById('shell-content')!;
          const table = document.querySelector('#run-items [role=treegrid][aria-label=Items]') as HTMLElement;
          const card = document.querySelector('#run-items [data-testid=data-table]') as HTMLElement;
          const t0 = table.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
          const out = [];
          for (let y = Math.max(0, t0 - 100); y < t0 + 1800; y += 130) {
            sc.scrollTop = y;
            await new Promise((r) => setTimeout(r, 200)); // (the header's return fades in over 150 ms)
            const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
            const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
            const line = Math.max(
              nav ? nav.getBoundingClientRect().bottom : 0,
              filters && getComputedStyle(filters).position === 'sticky'
                ? filters.getBoundingClientRect().bottom
                : 0,
            );
            const ths = Array.from(table.querySelectorAll(':scope > thead th')).map((t) =>
              t.getBoundingClientRect(),
            );
            const bar = document.querySelector('#run-items [data-item-bar]')?.getBoundingClientRect() ?? null;
            const c = card.getBoundingClientRect();
            const over = (el: Element | null) => {
              const r = el?.getBoundingClientRect();
              return r && ths.length
                ? Math.max(
                    0,
                    Math.min(r.bottom, Math.max(...ths.map((t) => t.bottom))) -
                      Math.max(r.top, Math.min(...ths.map((t) => t.top))),
                  )
                : 0;
            };
            const details = Array.from(table.querySelectorAll(':scope > tbody > tr[data-detail-row]')).map(
              (d) => d.getBoundingClientRect(),
            );
            const headBottom = ths.length ? Math.max(...ths.map((t) => t.bottom)) : 0;
            const headTop = ths.length ? Math.min(...ths.map((t) => t.top)) : 0;
            out.push({
              line,
              stuck: table.hasAttribute('data-stuck'),
              // the header would sit at the line without touching an open item
              lineClear: !details.some((d) => d.bottom > line && d.top < line + (headBottom - headTop)),
              headOverDetail: Math.max(
                0,
                ...details.map((d) => Math.min(d.bottom, headBottom) - Math.max(d.top, headTop)),
              ),
              head: ths.length
                ? { top: Math.min(...ths.map((r) => r.top)), left: Math.min(...ths.map((r) => r.left)) }
                : null,
              bar:
                bar && bar.top > 0 && bar.top < innerHeight
                  ? { top: bar.top, left: bar.left, right: bar.right }
                  : null,
              card: { left: c.left, right: c.right },
              toolbarOverlap: over(card.querySelector('[data-dt-toolbar]')),
              footerOverlap: over(card.querySelector('[data-testid=status-bar], [class*="footer"]')),
            });
          }
          return out;
        });

      const samples = await sweep();
      expect(samples.filter((m) => m.stuck).length, 'the header sticks at some stops').toBeGreaterThan(1);
      let barStops = 0;
      for (const m of samples) {
        // D3-5: a stuck header is at the line (0 px above), inside the card on the left, over no toolbar or footer
        // (the header is held above an item it would touch: round 3 P4, 0 px over the item)
        expect(m.headOverDetail, 'D3-5: header over the open item').toBeLessThanOrEqual(1);
        if (m.stuck && m.head && m.lineClear) {
          expect(Math.abs(m.head.top - m.line), 'D3-5: header at the line').toBeLessThanOrEqual(1.5);
          expect(m.head.left, 'D3-5: header cells inside the card (left)').toBeGreaterThanOrEqual(
            m.card.left - 1,
          );
        }
        expect(m.toolbarOverlap, 'D3-5: over the toolbar').toBeLessThanOrEqual(1);
        expect(m.footerOverlap, 'D3-5: over the footer').toBeLessThanOrEqual(1);
        // D3-6: the item bar never leaves the card sideways
        if (m.bar) {
          barStops++;
          expect(m.bar.left, 'D3-6: bar left').toBeGreaterThanOrEqual(m.card.left - 1);
          expect(m.bar.right, 'D3-6: bar right').toBeLessThanOrEqual(m.card.right + 1);
        }
      }
      expect(barStops, 'the item bar was seen').toBeGreaterThan(2);
      // D3-7: 1 px outside the card's left, right and bottom edge, no pinned cell, cue or overlay is stacked
      const outside = await page.evaluate((sel) => {
        const card = document.querySelector(sel)!.getBoundingClientRect();
        const bad: string[] = [];
        const top = Math.max(card.top, 0) + 4;
        const bottom = Math.min(card.bottom, innerHeight) - 4;
        const mark = (el: Element) =>
          el.hasAttribute('data-pin-edge') ||
          el.hasAttribute('data-edge') ||
          el.hasAttribute('data-cues') ||
          /edge|cue/i.test(String(el.className));
        for (let i = 0; i < 20; i++) {
          const y = top + ((bottom - top) * i) / 19;
          for (const x of [card.left - 1.5, card.right + 1.5])
            for (const el of document.elementsFromPoint(x, y))
              if (mark(el)) bad.push(`${el.tagName}@${Math.round(x)},${Math.round(y)}`);
        }
        for (let i = 0; i < 20; i++) {
          const x = card.left + ((card.right - card.left) * i) / 19;
          if (card.bottom + 1.5 < innerHeight)
            for (const el of document.elementsFromPoint(x, card.bottom + 1.5))
              if (mark(el)) bad.push(`${el.tagName}@${Math.round(x)},bottom`);
        }
        return bad;
      }, TABLE);
      expect(outside, 'D3-7: table chrome outside the card').toEqual([]);
    });
  });
}
