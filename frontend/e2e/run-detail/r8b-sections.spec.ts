/** Round 8b (owner decision H6): framed sections on the run-detail page (C-sec-1..6, C-sec-A1..A6), Repeat seed. */
import { expect, test, type Page } from '@playwright/test';
import {
  assertHeads,
  assertOnePrimitive,
  assertPanels,
  assertRhythm,
  fillAndEdge,
  nestedCards,
  noSideways,
  outsideContentBox,
  readSections,
  tokenColor,
} from '../shared/sections';
import { openRun, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;
let repeat: string;
test.beforeAll(async () => {
  s = await seedProject('rd-r8b-sections');
  repeat = await seedRepeat(s);
});

const IDS = [
  'run-section-overview',
  'run-section-repeat',
  'run-section-latency',
  'run-section-deep',
  'run-section-categories',
  'run-section-errors',
  'run-items',
];

/** Lazy sections mount when they near the viewport: walk the page once so every body has its loaded height. */
async function mountAll(page: Page): Promise<void> {
  for (const id of IDS) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'start' }), id);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => document.getElementById('shell-content')?.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

for (const width of [1440, 1024, 390]) {
  test.describe(`at ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openRun(page, s.slug, repeat);
      await mountAll(page);
    });

    test('C-sec-1/2/3, A1/A2/A3: one primitive, panels, rhythm, heads inside', async ({ page }) => {
      const sections = await readSections(page);
      assertOnePrimitive(sections, IDS);
      assertHeads(sections, width);
      await assertPanels(page, sections);
      assertRhythm(sections);
      // Items renders through the same primitive (C-sec-1)
      expect(sections.at(-1)!.part).toBe('section');
    });

    test('C-sec-5 (fix pass): nothing inside a panel leaves its content box', async ({ page }) => {
      test.skip(width !== 390, 'the review measured the phone; wider pages are asserted by the width tests');
      expect(await outsideContentBox(page)).toEqual([]);
    });

    test('C-sec-5/6, A4: inset cards, no nested card, no sideways scroll', async ({ page }) => {
      await noSideways(page);
      expect(await nestedCards(page)).toEqual([]);
      const elevated = await tokenColor(page, '--bg-elevated');
      const e = await fillAndEdge(page, '#run-section-latency section[aria-label]');
      expect(e.bg).toBe(elevated);
      expect(
        e.edgeColors.every((c) => c === 'rgba(0, 0, 0, 0)'),
        `outline ${e.edgeColors}`,
      ).toBe(true);
    });
  });
}

test('C-sec-A3 deep links: every section id still scrolls its panel under the nav', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, repeat, 'panel=errors');
  await expect
    .poll(async () => {
      const nav = await page.getByRole('navigation', { name: 'Run sections' }).boundingBox();
      const sec = await page.locator('#run-section-errors').boundingBox();
      return nav && sec ? Math.round(sec.y - (nav.y + nav.height)) : 999;
    })
    .toBeLessThanOrEqual(16);
});
