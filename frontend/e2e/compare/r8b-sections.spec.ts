/** Round 8b (owner decision H6): framed sections on the compare page (C-sec-1..6, C-sec-A1..A6). */
import { expect, test } from '@playwright/test';
import {
  assertHeads,
  assertOnePrimitive,
  assertPanels,
  assertRhythm,
  fillAndEdge,
  nestedCards,
  noSideways,
  readSections,
  tokenColor,
} from '../shared/sections';
import { box, openCompare, part, seedR8, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8b-sections');
});

const IDS = ['runs', 'averages', 'overview', 'categories', 'errors', 'items'].map((k) => `compare-${k}`);

for (const width of [1440, 1024, 390]) {
  test.describe(`at ${width}`, () => {
    test(`C-sec-1/2/3, A1/A2/A3: one primitive, panels, rhythm, heads inside`, async ({ page }) => {
      await openCompare(page, s.four, width);
      const sections = await readSections(page);
      assertOnePrimitive(sections, IDS);
      expect(sections.map((x) => x.part)).toEqual(IDS.map((id) => id.replace('compare-', 'section-')));
      assertHeads(sections, width);
      await assertPanels(page, sections);
      assertRhythm(sections);
    });

    test(`C-sec-4/5/6, A4: inset cards, no nested card, no sideways scroll, neutral tokens`, async ({
      page,
    }) => {
      await openCompare(page, s.four, width);
      await noSideways(page);
      expect(await nestedCards(page)).toEqual([]);
      const elevated = await tokenColor(page, '--bg-elevated');
      for (const sel of [
        '[data-part=run-card] > article',
        width === 390 ? '[data-part=averages-table] > *' : '[data-part=averages-table]',
        '[data-part=item-row]',
      ]) {
        const e = await fillAndEdge(page, sel);
        expect(e.bg, `${sel} fill`).toBe(elevated);
        expect(
          e.edgeWidths.every((w) => w === 1 || w === 0),
          `${sel} widths`,
        ).toBe(true);
        expect(
          e.edgeColors.every((c) => c === 'rgba(0, 0, 0, 0)'),
          `${sel} outline ${e.edgeColors}`,
        ).toBe(true);
      }
    });
  });
}

test('C-sec-4, A5, A6: the first screen keeps four cards in one row and the whole Averages table', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const cards = part(page, 'run-card');
  expect(await cards.count()).toBe(4);
  const tops = await cards.evaluateAll(
    (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().y))).size,
  );
  expect(tops).toBe(1);
  const card = await box(cards);
  const table = await box(part(page, 'averages-table'));
  expect(card.bottom, `cards bottom ${card.bottom}`).toBeLessThanOrEqual(530);
  expect(table.bottom, `averages table bottom ${table.bottom}`).toBeLessThanOrEqual(900);
  const panel = await box(part(page, 'section-runs'));
  expect((await box(cards.last())).right).toBeLessThanOrEqual(panel.right - 14 + 1);
});

test('C-sec-A5: at 1024 and 390 the cards reflow inside the panel padding', async ({ page }) => {
  for (const width of [1024, 390]) {
    await openCompare(page, s.four, width);
    const panel = await box(part(page, 'section-runs'));
    const cards = part(page, 'run-card');
    for (let i = 0; i < (await cards.count()); i++) {
      const b = await box(cards.nth(i));
      expect(b.x).toBeGreaterThanOrEqual(panel.x + 14 - 1);
      expect(b.right).toBeLessThanOrEqual(panel.right - 14 + 1);
    }
    await noSideways(page);
  }
});
