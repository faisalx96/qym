/**
 * I16 (November 2026): the item pane grows by itself to the width its metrics table needs, so every metric stays on
 * one line. The owner: "dynamically expand the drawer (must leave 25% of the runslist shown, so maximum 75%)".
 * The rule is a pure function of the reader's width (`base`), the need and the page area behind the pane.
 */
import { describe, expect, it } from 'vitest';
import { GROW_SHARE, defaultPaneWidth, growCap, paneWidth } from '../width';

describe('growCap', () => {
  it('is 75% of the page area, so a quarter of the list stays in view', () => {
    expect(GROW_SHARE).toBe(0.75);
    // 1600 viewport - 192 sidebar
    expect(growCap(1408)).toBe(1056);
    expect(growCap(1088)).toBe(816);
    expect(growCap(832)).toBe(624);
    expect(growCap(0)).toBe(0);
    expect(growCap(-50)).toBe(0);
  });
});

describe('paneWidth', () => {
  const area = 1408;

  it('stays at the base width when nothing asks for more', () => {
    expect(paneWidth({ base: 560, need: null, area })).toBe(560);
    expect(paneWidth({ base: 560, need: 500, area })).toBe(560);
    expect(paneWidth({ base: 560, need: 560, area })).toBe(560);
    expect(paneWidth({ base: 560, need: Number.NaN, area })).toBe(560);
  });

  it('grows to what the content needs', () => {
    expect(paneWidth({ base: 560, need: 690, area })).toBe(690);
    expect(paneWidth({ base: 560, need: 689.2, area })).toBe(690);
  });

  it('never grows past 75% of the page area', () => {
    expect(paneWidth({ base: 560, need: 2000, area })).toBe(1056);
    expect(paneWidth({ base: 560, need: Number.POSITIVE_INFINITY, area })).toBe(560);
    // a 1024 viewport: the table scrolls inside a pane of 624
    expect(paneWidth({ base: 560, need: 700, area: 832 })).toBe(624);
  });

  it('never goes below the reader width, even when that is wider than the cap', () => {
    // the reader dragged the pane to 1200 (or took the whole page): growth never narrows it
    expect(paneWidth({ base: 1200, need: 1300, area })).toBe(1200);
    // a small viewport where the cap is under the smallest pane: no growth
    expect(paneWidth({ base: 560, need: 700, area: 712 })).toBe(560);
  });

  it('gives the growth back when the need drops (a pass leaves the view)', () => {
    const grown = paneWidth({ base: 560, need: 690, area });
    expect(grown).toBe(690);
    expect(paneWidth({ base: 560, need: 608, area })).toBe(608);
    expect(paneWidth({ base: 560, need: null, area })).toBe(560);
  });
});

describe('defaultPaneWidth', () => {
  it('keeps the design width when it fits under the cap', () => {
    expect(defaultPaneWidth(1040, 560, 1408, 240)).toBe(1040);
    expect(defaultPaneWidth(960, 560, 1408, 240)).toBe(960);
  });

  it('caps the default at 75% of the page area too', () => {
    // a 1280 viewport: 1088 - 240 = 848 would cover 78% of the list; the cap is 816
    expect(defaultPaneWidth(1040, 560, 1088, 240)).toBe(816);
    expect(defaultPaneWidth(1040, 560, 832, 240)).toBe(592);
  });

  it('never goes under the smallest pane', () => {
    expect(defaultPaneWidth(1040, 560, 712, 240)).toBe(560);
    expect(defaultPaneWidth(1040, 560, 0, 240)).toBe(560);
  });
});
