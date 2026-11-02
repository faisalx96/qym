/// <reference lib="dom" />
/** Round 3 P2 (run-detail.md section 2): repeat analysis with a metric Select, flat centred tiles, full width. P2-1 .. P2-13. */
import { test, expect, type Page } from '@playwright/test';
import { chooseOption, openRun, params, seedProject, seedWideRepeat, type Seeded } from './support';

let s: Seeded;
let wide: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r3-repeat');
  wide = await seedWideRepeat(s);
});

async function open(page: Page, width: number, query = 'panel=repeat') {
  await page.setViewportSize({ width, height: 1000 });
  await openRun(page, s.slug, wide, query);
  const panel = page.getByTestId('repeat-analysis');
  await expect(panel.getByRole('list', { name: 'Repeat run statistics' })).toBeVisible();
  await page.waitForFunction(
    () =>
      !document
        .getAnimations()
        .some((a) => /rise|count-in|grow|arrive/.test((a as CSSAnimation).animationName ?? '')),
  );
  return panel;
}

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test('P2-1, P2-2, P2-13: one Select of 280px, nothing wider than the column, no page scroll', async ({
      page,
    }) => {
      const panel = await open(page, width);
      const select = panel.getByRole('button', { name: /Metric/ }).first();
      await expect(select).toHaveAttribute('aria-haspopup', 'listbox');
      await expect(select).toContainText('correct');
      if (width === 1440) expect(Math.round((await select.boundingBox())!.width)).toBe(280);
      await expect(
        page.locator('#run-section-repeat').getByRole('radiogroup', { name: 'Metric' }),
      ).toHaveCount(0);
      const over = await page.evaluate(() => {
        const sec = document.getElementById('run-section-repeat')!;
        const col = sec.querySelector('[data-testid=repeat-analysis]')!.getBoundingClientRect();
        return Array.from(sec.querySelectorAll('*'))
          .filter((e) => !e.closest('[data-dt-scroller]') && !String(e.className).includes('_rail'))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > col.right + 1;
          })
          .map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}`)
          .slice(0, 5);
      });
      expect(over).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('P2-4..P2-8: seven separate centred tiles that fill the width with 8px gaps', async ({ page }) => {
      const panel = await open(page, width);
      const tiles = panel.getByRole('list', { name: 'Repeat run statistics' }).getByRole('listitem');
      await expect(tiles).toHaveCount(7);
      expect(await panel.locator('[data-group]').count()).toBe(0);
      const info = await page.evaluate(() => {
        const list = document.querySelector('[aria-label="Repeat run statistics"]')!;
        const lr = list.getBoundingClientRect();
        return Array.from(list.children).map((t) => {
          const r = t.getBoundingClientRect();
          const cx = (r.left + r.right) / 2;
          const parts = Array.from(t.querySelectorAll('span')).filter(
            (x) => x.children.length === 0 || x.textContent!.length > 3,
          );
          // the label is its text plus the info marker (the marker's hidden tooltip text is not drawn)
          const edge = (p: Element | null) => {
            const el = p as HTMLElement;
            const first = el.firstElementChild ?? el;
            const last = el.querySelector('button') ?? first;
            const range = document.createRange();
            range.selectNodeContents(first);
            return (range.getBoundingClientRect().left + last.getBoundingClientRect().right) / 2;
          };
          const mid = (p: Element | null) => {
            const range = document.createRange();
            range.selectNodeContents(p!);
            const b = range.getBoundingClientRect();
            return (b.left + b.right) / 2;
          };
          const centred = [
            edge(t.querySelector('[data-part=label]')),
            mid(t.querySelector('[data-part=value]')),
            mid(t.querySelector('[data-part=meaning]')),
          ].map((m) => Math.abs(m - cx));
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            w: r.width,
            h: r.height,
            meaning: t.querySelector('[data-part=meaning]')!.textContent!.length,
            centred,
            parts: parts.length,
            listLeft: lr.left,
            listRight: lr.right,
          };
        });
      });
      info.forEach((t, i) => {
        expect(t.meaning).toBeGreaterThan(0);
        expect(t.meaning).toBeLessThanOrEqual(80);
        t.centred.forEach((d, j) =>
          expect(d, `tile ${i} part ${j}: ${JSON.stringify(t)}`).toBeLessThanOrEqual(width === 390 ? 7 : 2), // 390: the label wraps in the 120 px tile since the section panel took 30 px (owner decision H6), measured 5.9
        );
      });
      expect(Math.round(info[0]!.left)).toBe(Math.round(info[0]!.listLeft));
      if (width === 1440) {
        for (const t of info) {
          expect(Math.abs(t.w - info[0]!.w)).toBeLessThanOrEqual(1);
          expect(Math.abs(t.h - info[0]!.h)).toBeLessThanOrEqual(1);
        }
        for (let i = 1; i < 7; i++)
          expect(Math.abs(info[i]!.left - info[i - 1]!.right - 8)).toBeLessThanOrEqual(1);
        expect(Math.abs(info[6]!.right - info[0]!.listRight)).toBeLessThanOrEqual(1);
      } else {
        // two columns and a full-width seventh tile
        expect(Math.abs(info[1]!.right - info[1]!.listRight)).toBeLessThanOrEqual(1);
        expect(Math.round(info[6]!.w)).toBeGreaterThan(info[0]!.w * 1.8);
        expect(Math.abs(info[2]!.top - info[1]!.bottom - 8)).toBeLessThanOrEqual(1);
      }
    });

    test('P2-9: curve and distribution side by side (wide) or stacked, equal height when side by side', async ({
      page,
    }) => {
      const panel = await open(page, width);
      const a = (await panel.getByRole('region', { name: 'Performance across attempts' }).boundingBox())!;
      const b = (await panel.getByRole('region', { name: 'Distribution of passes passed' }).boundingBox())!;
      const col = (await panel.boundingBox())!;
      if (width === 1440) {
        expect(a.width / b.width).toBeGreaterThan(1.9);
        expect(a.width / b.width).toBeLessThan(2.1);
        expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      } else {
        expect(b.y).toBeGreaterThan(a.y + a.height - 1);
        expect(Math.abs(a.width - col.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.width - col.width)).toBeLessThanOrEqual(1);
      }
    });

    test('P2-10, P2-11, P2-12: the By pass table is as wide as the column with at most 7 columns; counts sit on bars; section height', async ({
      page,
    }) => {
      const panel = await open(page, width);
      const card = panel.getByRole('region', { name: 'Passes', exact: true });
      const col = (await panel.boundingBox())!;
      expect(Math.abs((await card.boundingBox())!.width - col.width)).toBeLessThanOrEqual(1);
      const grid = card.getByRole('grid', { name: 'Passes' }).or(card.getByRole('table', { name: 'Passes' }));
      expect(await grid.getByRole('columnheader').count()).toBeLessThanOrEqual(7);
      await expect(grid.getByRole('row')).toHaveCount(11);
      const bars = panel.getByRole('group', { name: 'Items by number of passes that passed' });
      await expect(bars.locator('[data-part=count]')).toHaveCount(11);
      // Errors stays inside the card on the phone column (the table does not scroll away from it)
      const err = await grid.getByRole('columnheader', { name: /Errors/ }).boundingBox();
      expect(err!.x + err!.width).toBeLessThanOrEqual(
        (await card.boundingBox())!.x + (await card.boundingBox())!.width + 1,
      );
      // P2-12 is measured on the whole section (header included), as the review did
      const h = (await page.locator('#run-section-repeat').boundingBox())!.height;
      expect(h, 'section height').toBeLessThanOrEqual(width === 1440 ? 1150 : 1950);
    });
  });
}

test('P2-10b: the Metrics picker lists all 24 metrics and two picks add two columns', async ({ page }) => {
  const panel = await open(page, 1440);
  const card = panel.getByRole('region', { name: 'Passes', exact: true });
  const grid = card.getByRole('grid', { name: 'Passes' });
  const before = await grid.getByRole('columnheader').count();
  await card.getByRole('button', { name: /Metrics/ }).click();
  const options = page.getByRole('checkbox');
  expect(await options.count()).toBeGreaterThanOrEqual(24);
  await page.getByRole('checkbox', { name: 'rubric_metric_01' }).check({ force: true });
  await page.getByRole('checkbox', { name: 'rubric_metric_02' }).check({ force: true });
  await page.keyboard.press('Escape');
  await expect.poll(() => grid.getByRole('columnheader').count()).toBe(before + 2);
  await expect(card.getByTestId('metrics-shown')).toContainText('3 of 24');
});

test('P2-3: choosing a metric writes ?metric=, survives a reload and keeps every pass in the table', async ({
  page,
}) => {
  const panel = await open(page, 1440);
  const avg = panel.locator('[data-tile=avg] [data-part=value]');
  const before = await avg.innerText();
  await chooseOption(page, panel.getByRole('button', { name: /Metric/ }).first(), 'rubric_metric_03');
  await expect.poll(() => params(page).get('metric')).toBe('rubric_metric_03');
  await expect(avg).not.toHaveText(before);
  await page.reload();
  const again = page.getByTestId('repeat-analysis');
  await expect(again.getByRole('button', { name: /Metric/ }).first()).toContainText('rubric_metric_03');
  await expect(again.getByRole('region', { name: 'Passes', exact: true }).getByRole('row')).toHaveCount(11);
});

test('P2-12 numeric: with the by-pass distribution card the section stays within the amended 1,600px (1440) / 2,520px (390)', async ({
  page,
}) => {
  for (const [w, limit] of [
    [1440, 1600],
    [390, 2520],
  ] as const) {
    await page.setViewportSize({ width: w, height: 1000 });
    await openRun(page, s.slug, wide, 'panel=repeat&metric=rubric_metric_01');
    await expect(page.getByRole('region', { name: 'rubric_metric_01 by pass' })).toBeVisible();
    const h = (await page.locator('#run-section-repeat').boundingBox())!.height;
    expect(h, `numeric section at ${w}`).toBeLessThanOrEqual(limit);
  }
});

test('P2-4 numeric metric: three tiles', async ({ page }) => {
  // the wide run has no numeric metric: assert the 7-tile contract here, the 3-tile contract is the unit test of RepeatTiles
  const panel = await open(page, 1440);
  await expect(panel.getByRole('list', { name: 'Repeat run statistics' }).getByRole('listitem')).toHaveCount(
    7,
  );
});
