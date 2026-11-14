/// <reference lib="dom" />
/**
 * Redesign round 7, D3 (docs/internal/ui-migration/redesign7/qa.md): table boundaries are visible only inside the table.
 * The items table: no overlay, the pinned cells draw no line and no gap, and the sticky header stays inside the card.
 * Criteria D3-1, D3-2, D3-4, D3-5 and D3-7 at 1440 and 1024 (390 is cards).
 * An item opens in the pane at the side now (a portal on the body, over the table), so no row expands in the table.
 * D3-3 (nothing stacked over the open item's text in the table) and D3-6 (the sticky item bar) have no subject: deleted.
 */
import { test, expect, type Page } from '@playwright/test';
import { ANY_LINE, coveredText, edgeReport, expectedShade, NO_LINE } from '../edges';
import { openRun, seedClassic, seedProject, showItems, type Seeded } from './support';

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

    test('D3-1, D3-2, D3-4: no overlay, no pinned-edge line and no gap in it, at rest and scrolled', async ({
      page,
    }) => {
      await openRun(page, s.slug, runId);
      await showItems(page);
      await expect(page.locator(`${TABLE} td[data-pin-edge]`).first()).toBeVisible();

      const check = async (state: string): Promise<void> => {
        const rep = await edgeReport(page, TABLE);
        expect(rep.overlays, `${state}: overlay elements (D3-1, D3-4)`).toBe(0);
        expect(
          await page.locator('#run-items [data-edge]').count(),
          `${state}: [data-edge] in #run-items`,
        ).toBe(0);
        // round 9: the pinned cells draw no line; an edge shades only while content is scrolled under it
        for (const c of rep.cells) {
          if (c.rail) expect(c.shadow, `${state}: ${c.edge} rail row`).not.toMatch(ANY_LINE);
          else expect(c.shadow, `${state}: ${c.edge} ${c.tag}`).toBe(NO_LINE);
          expect(c.shade, `${state}: ${c.edge} ${c.tag} shade`).toBe(expectedShade(c, rep.scrolled));
          // D3-2: no pinned-edge element is taller than a row (the old cue was as tall as the 500-row body)
          expect(c.bottom - c.top, `${state}: pinned-edge cell height`).toBeLessThanOrEqual(80);
        }
        expect(await coveredText(page, TABLE), `${state}: covered text (D3-1)`).toEqual([]);
        // D3-2: no row expands in place (the item opens in the pane), so the table has no detail row and no gap
        expect(
          rep.detailRows.filter((d) => !d.strip),
          `${state}: detail rows`,
        ).toEqual([]);
        // C230: the trace column is no longer pinned at the start, so the check is for the start edge
        for (const side of ['start'] as const) {
          // round 8b: below 8 px is the virtualizer's end spacer (5.1 px at 1024 once the section panel adds its bottom padding), not a row without the line
          const gaps = rep.gaps[side].filter((g) => g > 8);
          expect(gaps, `${state}: ${side} gaps`).toEqual([]);
        }
      };

      await check('rest');
      await scrollShell(
        page,
        (await page.evaluate(() => document.getElementById('shell-content')!.scrollTop)) + 260,
      );
      await check('scrolled 260 px');
      await scrollShell(page, 'end');
      await check('scrolled to the end');
    });

    test('D3-5, D3-7: the sticky header stays inside the card; nothing of the table lies outside it', async ({
      page,
    }) => {
      await openRun(page, s.slug, runId);
      await showItems(page);
      const sweep = (): Promise<
        Array<{
          line: number;
          stuck: boolean;
          head: { top: number; left: number } | null;
          card: { left: number; right: number };
          toolbarOverlap: number;
          footerOverlap: number;
        }>
      > =>
        page.evaluate(async () => {
          const sc = document.getElementById('shell-content')!;
          const table = document.querySelector('#run-items [role=grid][aria-label=Items]') as HTMLElement;
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
            out.push({
              line,
              stuck: table.hasAttribute('data-stuck'),
              head: ths.length
                ? { top: Math.min(...ths.map((r) => r.top)), left: Math.min(...ths.map((r) => r.left)) }
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
      for (const m of samples) {
        // D3-5: a stuck header is at the line (0 px above), inside the card on the left, over no toolbar or footer
        if (m.stuck && m.head) {
          expect(Math.abs(m.head.top - m.line), 'D3-5: header at the line').toBeLessThanOrEqual(1.5);
          expect(m.head.left, 'D3-5: header cells inside the card (left)').toBeGreaterThanOrEqual(
            m.card.left - 1,
          );
        }
        expect(m.toolbarOverlap, 'D3-5: over the toolbar').toBeLessThanOrEqual(1);
        expect(m.footerOverlap, 'D3-5: over the footer').toBeLessThanOrEqual(1);
      }
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
