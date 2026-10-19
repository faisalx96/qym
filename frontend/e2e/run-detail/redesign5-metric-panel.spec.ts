/// <reference lib="dom" />
/**
 * Round 5 R3 (docs/internal/ui-migration/redesign5/run-detail.md): the item metric matrix and the detail panel a clicked score
 * opens. R3-1 .. R3-21 on run `details` item r5-005 (English `rubric_judge`, Arabic `arabic_judge`) at 1440 and 390.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  openRun,
  seedProject,
  seedR5,
  type Seeded,
} from './support';

let s: Seeded;
let details: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r5-panel');
  details = (await seedR5(s)).details;
});

async function openPanel(
  page: Page,
  metric: string,
  width: number,
): Promise<{ card: Locator; panel: Locator }> {
  await page.setViewportSize({ width, height: 1000 });
  await openRun(page, s.slug, details, 'item=r5-005');
  const card = page.locator('[data-testid=item-card][data-item-id="r5-005"]');
  await expect(card).toBeVisible();
  await card.locator(`[data-cell^="${metric}::"]`).first().click();
  const panel = card.getByTestId('metric-detail');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(250);
  return { card, panel };
}

for (const width of [1440, 390] as const) {
  test.describe(`${width}px`, () => {
    test('R3-1, R3-15, R3-20: header row, text Edit button, no sideways scroll', async ({ page }) => {
      const { panel } = await openPanel(page, 'rubric_judge', width);
      const h = await panel.evaluate((el) => {
        const head = el.querySelector(':scope > header')!;
        const edit = Array.from(head.querySelectorAll('button')).find((b) =>
          /Edit score/.test(b.textContent ?? ''),
        )!;
        const er = edit.getBoundingClientRect();
        return {
          height: head.getBoundingClientRect().height,
          hasScore: !!head.querySelector('[data-band]') || /%/.test(head.textContent ?? ''),
          name: head.textContent,
          editH: er.height,
          editVisible: er.width > 0 && getComputedStyle(edit).opacity !== '0',
          panelScroll: el.scrollWidth - el.clientWidth,
          pageScroll: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      console.log(`R3-1 ${width}px header ${h.height}px`);
      expect(h.height).toBeLessThanOrEqual(width === 390 ? 80 : 40);
      expect(h.name).toContain('rubric_judge');
      expect(h.hasScore).toBe(true);
      expect(Math.abs(h.editH - 24)).toBeLessThanOrEqual(1);
      expect(h.editVisible).toBe(true);
      expect(h.panelScroll).toBeLessThanOrEqual(0);
      expect(h.pageScroll).toBeLessThanOrEqual(0);
      // Edit opens the editor in the panel (title "Edit {metric}"), Escape and Close return focus to the matrix cell
      await panel.getByRole('button', { name: 'Edit score', exact: true }).click();
      await expect(panel.getByText('Edit rubric_judge')).toBeVisible();
      await panel.getByRole('button', { name: 'Close rubric_judge details' }).click();
      await expect(page.getByTestId('metric-detail')).toHaveCount(0);
      await expect(page.locator('[data-cell^="rubric_judge::"]').first()).toBeFocused();
    });

    for (const [metric, rtl] of [
      ['rubric_judge', false],
      ['arabic_judge', true],
    ] as const) {
      test(`R3-2, R3-3, R3-4, R3-5, R3-6, R3-13 (${metric}): no label overlaps its value; prose is stacked; type roles`, async ({
        page,
      }) => {
        const { panel } = await openPanel(page, metric, width);
        const m = await panel.evaluate((el) => {
          const box = (e: Element) => e.getBoundingClientRect();
          const facts = Array.from(el.querySelectorAll('dl > div')).map((row) => {
            const dt = row.querySelector('dt')!;
            const dd = row.querySelector('dd')!;
            return {
              key: dt.textContent,
              dtRight: box(dt).right,
              dtBottom: box(dt).bottom,
              ddLeft: box(dd).left,
              ddTop: box(dd).top,
              gap: box(dd).left - box(dt).right,
              clipped: dt.scrollWidth > dt.clientWidth + 1,
              ellipsis: getComputedStyle(dt).textOverflow === 'ellipsis',
              rtl: dd.getAttribute('dir') === 'rtl',
            };
          });
          const prose = Array.from(el.querySelectorAll('[data-part=prose]')).map((p) => {
            const eb = p.querySelector('[data-part=eyebrow]')!;
            const tx = p.querySelector('[data-part=prose-text]')!;
            const inner = tx.firstElementChild!;
            const cs = getComputedStyle(tx);
            return {
              key: p.getAttribute('data-key'),
              ebBottom: box(eb).bottom,
              txTop: box(inner).top,
              ebLeft: box(eb).left,
              txLeft: box(tx).left,
              fontSize: cs.fontSize,
              lineHeight: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
              color: cs.color,
              maxInline: cs.maxInlineSize,
              panelLeft: box(el).left,
              dirOnInner: inner.hasAttribute('dir'),
              dirOnWrapper: tx.hasAttribute('dir'),
              lang: inner.getAttribute('lang'),
            };
          });
          // label roles: distinct (size, weight, transform) among eyebrows, fact keys and tree keys
          const roles = new Set<string>();
          const add = (e: Element) => {
            const c = getComputedStyle(e);
            roles.add(
              `${c.fontSize}|${c.fontWeight}|${c.textTransform}|${c.fontFamily.includes('mono') ? 'mono' : 'sans'}`,
            );
          };
          el.querySelectorAll('[data-part=eyebrow], dl dt, [data-keytree] [class*=key]').forEach(add);
          return {
            facts,
            prose,
            roles: Array.from(roles),
            probe: Array.from(el.querySelectorAll('dl dt')).length,
          };
        });
        expect(m.facts.length).toBeGreaterThan(0);
        expect(m.prose.length).toBeGreaterThan(0);
        for (const f of m.facts) {
          if (width === 390 || f.ddTop > f.dtBottom - 2) {
            expect(f.ddTop, `${f.key} stacked`).toBeGreaterThanOrEqual(f.dtBottom + 2 - 0.5);
          } else {
            expect(f.gap, `${f.key} gap`).toBeGreaterThanOrEqual(12 - 0.5);
            if (rtl && f.rtl) expect(f.gap).toBeLessThanOrEqual(14.5);
          }
          // round 7 (D2) reverses round 5: a fact key wraps in its column, it is never cut
          expect(f.clipped, `${f.key} is whole`).toBe(false);
          expect(f.ellipsis, `${f.key} has no ellipsis`).toBe(false);
        }
        for (const p of m.prose) {
          expect(p.txTop, `${p.key} stacked`).toBeGreaterThanOrEqual(p.ebBottom + 2 - 0.5);
          expect(Math.abs(p.ebLeft - p.txLeft)).toBeLessThanOrEqual(1);
          expect(p.fontSize).toBe('13px');
          expect(p.lineHeight).toBeGreaterThanOrEqual(p.lang === 'ar' ? 1.7 - 0.01 : 1.6 - 0.01);
          expect(p.dirOnInner).toBe(true);
          expect(p.dirOnWrapper).toBe(false);
          expect(Math.abs(p.txLeft - (p.panelLeft + 15))).toBeLessThanOrEqual(2);
        }
        expect(m.prose[0]!.key).toMatch(/^reason/);
        console.log(`R3-13 ${metric} ${width}px roles ${JSON.stringify(m.roles)}`);
        expect(m.roles.length).toBeLessThanOrEqual(3);
      });
    }

    test('R3-3 (round 7, D2): every key (fact key or eyebrow) is whole in its column and never painted over its value', async ({
      page,
    }) => {
      const { panel } = await openPanel(page, 'rubric_judge', width);
      const keys = await panel.evaluate((el) =>
        Array.from(el.querySelectorAll('dl dt, [data-part=eyebrow]')).map((k) => ({
          // a fact key shows the key as written; the prose label is the one uppercase label and carries the raw key
          key: k.getAttribute('title') ?? k.textContent,
          overflow: k.scrollWidth - k.clientWidth,
          ellipsis: getComputedStyle(k).textOverflow,
        })),
      );
      expect(keys.map((k) => k.key)).toContain('self_consistency_check_result');
      expect(keys.map((k) => k.key)).toContain('detailed_reasoning_trace');
      for (const k of keys) {
        expect(k.overflow, String(k.key)).toBeLessThanOrEqual(0);
        expect(k.ellipsis, String(k.key)).not.toBe('ellipsis');
      }
    });

    test('R3-8, R3-9, R3-10, R3-11, R3-12: tables, no [0] rows, headers 34, rows 32, sorting, scroll inside, 12 rows then more', async ({
      page,
    }) => {
      const { panel } = await openPanel(page, 'rubric_judge', width);
      for (const t of ['Score table', 'Criteria', 'Evidence', 'Log table'])
        await expect(panel.getByRole('grid', { name: t })).toBeVisible();
      await expect(panel.locator('[aria-expanded]', { hasText: /^\s*\[\d+\]/ })).toHaveCount(0);
      for (const k of ['breakdown', 'flags'])
        await expect(panel.locator('[aria-expanded]', { hasText: k }).first()).toBeVisible();
      const grid = panel.getByRole('grid', { name: 'Evidence' });
      const geo = await grid.evaluate((g) => {
        const head = g
          .querySelector('[role=columnheader]')!
          .closest('[role=row]')!
          .getBoundingClientRect().height;
        const rows = Array.from(g.querySelectorAll('[role=row]')).filter(
          (r) => !r.querySelector('[role=columnheader]'),
        );
        return { head, rows: rows.map((r) => r.getBoundingClientRect().height) };
      });
      console.log(`R3-9 ${width}px head ${geo.head} rows ${geo.rows.join(',')}`);
      expect(Math.abs(geo.head - 34)).toBeLessThanOrEqual(1);
      for (const r of geo.rows) expect(Math.abs(r - 32)).toBeLessThanOrEqual(1);
      expect(geo.rows.length).toBe(3);
      // sorting: the first body cell of a text column changes
      const firstCell = () =>
        grid.locator('[role=row]').nth(1).locator('[role=gridcell]').first().textContent();
      const before = await firstCell();
      const sortBtn = grid.getByRole('columnheader', { name: /Doc/ });
      await expect(sortBtn).toHaveAttribute('aria-sort', /none|ascending|descending/);
      await sortBtn.click();
      const after = await firstCell();
      expect(after).not.toBe(before);
      // R3-12
      const log = panel.getByRole('grid', { name: 'Log table' });
      await expect(log.locator('[role=row]:has([role=gridcell])')).toHaveCount(12);
      await panel.getByRole('button', { name: 'Show 2 more rows' }).click();
      await expect(log.locator('[role=row]:has([role=gridcell])')).toHaveCount(14);
      // R3-10: the panel never scrolls sideways
      const sw = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sw).toBeLessThanOrEqual(0);
    });

    test('R3-14: panel height', async ({ page }) => {
      const { panel } = await openPanel(page, 'rubric_judge', width);
      // the criterion's fixture has no 14-row log table: hide it for the measurement
      await panel
        .locator('[data-key=log_table]')
        .evaluate((e) => ((e as HTMLElement).style.display = 'none'));
      const h = (await panel.boundingBox())!.height;
      console.log(`R3-14 ${width}px panel height ${h}`);
      expect(h).toBeLessThanOrEqual(width === 390 ? 1540 : 1040); // amended, see spec R3-14 (1530 -> 1540 in round 7: long fact keys wrap instead of ending in an ellipsis)
    });

    test('R3-16, R3-17, R3-18: matrix reason anchor, row heights, selected row', async ({ page }) => {
      const { card } = await openPanel(page, 'arabic_judge', width);
      const m = await card.evaluate((el) => {
        const grid = el.querySelector('[role=grid][aria-label="Metrics by pass"]')!;
        const row = grid.querySelector('[data-metric="arabic_judge"]')!;
        const head = grid.querySelector('[role=columnheader]')!.closest('[role=row]')!;
        const cell = el.querySelector('[data-cell^="arabic_judge::"]') as HTMLElement;
        const reasonCell = Array.from(row.querySelectorAll('[role=gridcell]')).pop()!;
        const text = reasonCell.querySelector('[dir]');
        const name = row.querySelector('[class*=metricName]')!;
        const cs = getComputedStyle(cell);
        const rs = getComputedStyle(row);
        const ns = getComputedStyle(name);
        return {
          rowH: row.getBoundingClientRect().height,
          headH: head.getBoundingClientRect().height,
          reasonOffset: text
            ? text.getBoundingClientRect().left - reasonCell.getBoundingClientRect().left
            : null,
          cellWeight: cs.fontWeight,
          cellFont: cs.fontFamily.includes('mono'),
          cellOutline: cs.outlineStyle + cs.outlineWidth,
          rowBg: rs.backgroundColor,
          rowShadow: rs.boxShadow,
          nameWeight: ns.fontWeight,
          nameSize: ns.fontSize,
        };
      });
      console.log(`R3-16/17 ${width}px ${JSON.stringify(m)}`);
      expect(Math.abs(m.rowH - 32)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.headH - 34)).toBeLessThanOrEqual(1);
      expect(m.cellWeight).toBe('600');
      expect(m.cellFont).toBe(true);
      expect(m.nameWeight).toBe('400');
      expect(m.cellOutline).not.toContain('2px');
      expect(m.rowShadow).not.toBe('none');
      expect(m.rowBg).not.toBe('rgba(0, 0, 0, 0)');
      if (width === 1440) expect(m.reasonOffset!).toBeLessThanOrEqual(12.5);
    });

    test('R3-22: axe finds no serious or critical violation with the panel open (English and Arabic)', async ({
      page,
    }) => {
      for (const metric of ['rubric_judge', 'arabic_judge']) {
        await openPanel(page, metric, width);
        const v = (await axeSeriousViolations(page, '[data-testid=metric-detail]')).filter(
          (x) => x.impact === 'serious' || x.impact === 'critical',
        );
        expect(v, `${metric}\n${describeViolations(v)}`).toEqual([]);
      }
    });

    test('R3-21 (round 7, D2): FieldRow labels (Input, Expected, Tags) never overflow their column, they wrap', async ({
      page,
    }) => {
      const { card } = await openPanel(page, 'rubric_judge', width);
      const over = await card.evaluate((el) =>
        Array.from(el.querySelectorAll('[role=group][aria-labelledby]'))
          .map((g) => g.firstElementChild as HTMLElement)
          .filter((l) => l && l.scrollWidth > l.clientWidth + 1)
          .map((l) => l.textContent),
      );
      expect(over).toEqual([]);
    });

    test('R3-7 (round 7, D2): output key rows show the whole key (no 28ch cap) and keep 8px before the preview', async ({
      page,
    }) => {
      const { card } = await openPanel(page, 'rubric_judge', width);
      const rows = await card.evaluate((el) =>
        Array.from(el.querySelectorAll('section[aria-label=Output] [data-keytree] [data-part=key]')).map(
          (key) => {
            const pv = key.nextElementSibling;
            const sameLine =
              pv &&
              Math.min(pv.getBoundingClientRect().bottom, key.getBoundingClientRect().bottom) -
                Math.max(pv.getBoundingClientRect().top, key.getBoundingClientRect().top) >
                2;
            return {
              maxInline: getComputedStyle(key).maxInlineSize,
              title: key.getAttribute('title'),
              overflow: key.scrollWidth - key.clientWidth,
              gap: pv && sameLine ? pv.getBoundingClientRect().left - key.getBoundingClientRect().right : 99,
            };
          },
        ),
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.maxInline).not.toMatch(/ch$/); // the 28ch cap is gone
        expect(r.title).toBeNull();
        expect(r.overflow).toBeLessThanOrEqual(0);
        expect(r.gap).toBeGreaterThanOrEqual(7.5);
      }
    });
  });
}

test('R3-9b (review fix): table cells have the header padding; adjacent texts are at least 12px apart; the first column lines up with its header', async ({
  page,
}) => {
  for (const width of [1440, 1024, 640]) {
    const { panel } = await openPanel(page, 'rubric_judge', width);
    for (const name of ['Evidence', 'Criteria', 'Log table']) {
      const m = await panel.getByRole('grid', { name }).evaluate((g) => {
        const textBox = (el: Element) => {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
          });
          const node = w.nextNode()!;
          const r = document.createRange();
          r.selectNodeContents(node);
          return r.getBoundingClientRect();
        };
        const head = Array.from(g.querySelectorAll('[role=columnheader]'));
        const row = g.querySelector('tr:has([role=gridcell])')!;
        const cells = Array.from(row.children);
        // a clipped (ellipsised) text ends at its cell's inner edge
        const boxes = cells.map((c) => {
          const b = textBox(c.querySelector('[data-cell]') ?? c);
          return { left: b.left, right: Math.min(b.right, c.getBoundingClientRect().right - 8) };
        });
        const gaps = boxes.slice(1).map((b, i) => b.left - boxes[i]!.right);
        const headText = textBox(head[0]!);
        return {
          pad: getComputedStyle(cells[0]!).paddingLeft,
          gaps,
          firstDelta: Math.abs(boxes[0]!.left - headText.left),
        };
      });
      console.log(`R3-9b ${width}px ${name} ${JSON.stringify(m)}`);
      expect(parseFloat(m.pad), `${name} ${width} padding`).toBeGreaterThanOrEqual(8);
      for (const g of m.gaps) expect(g, `${name} ${width} gap`).toBeGreaterThanOrEqual(12);
      expect(m.firstDelta, `${name} ${width} first column vs header`).toBeLessThanOrEqual(1.5);
    }
  }
});
