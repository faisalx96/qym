/// <reference lib="dom" />
/**
 * Redesign round 7, D2 (docs/internal/ui-migration/redesign7/qa.md): the name of a JSON key is always fully visible and
 * never overlaps its value. Items j-01 (English) and j-03 (Arabic) of the `seedR7JsonKeys` run at 1440 / 1024 / 390:
 * the Output key tree (collapsed and fully open), the Expected sections, the metric panel's facts, prose label and nested
 * tree, and the item's tags. Criteria D2-1 to D2-13 and D2-15 (a data key renders exactly as written, case included).
 */
import { test, expect, type Page } from '@playwright/test';
import { keyProbe, type KeyRowReport, type ProbeKind } from './keysProbe';
import { r7AllKeys } from './seed';
import { openRun, seedJsonKeys, seedProject, type Seeded } from './support';

let s: Seeded;
let runId: string;
const ALL_KEYS = r7AllKeys();

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r7-keys');
  runId = await seedJsonKeys(s);
});

interface Regions {
  expected: KeyRowReport[];
  collapsed: KeyRowReport[];
  expanded: KeyRowReport[];
  facts: KeyRowReport[];
  eyebrow: KeyRowReport[];
  panelTree: KeyRowReport[];
}

async function measure(page: Page, width: number, item: string): Promise<Regions> {
  await page.setViewportSize({ width, height: 1000 });
  await openRun(page, s.slug, runId, `item=${item}`);
  const sel = `[data-testid=item-card][data-item-id="${item}"]`;
  const card = page.locator(sel);
  await expect(card).toBeVisible();
  await page.waitForTimeout(500);
  const m = (root: string, kind: ProbeKind) => page.evaluate(keyProbe, [root, kind] as [string, ProbeKind]);
  const expected = (await m(`${sel} [data-kind=expected]`, 'sections'))!;
  const collapsed = (await m(`${sel} [data-kind=output] [data-keytree]`, 'tree'))!;
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await page.waitForTimeout(500);
  const expanded = (await m(`${sel} [data-kind=output] [data-keytree]`, 'tree'))!;
  await card.locator('[data-cell^="schema_judge::"]').first().click();
  await expect(card.getByTestId('metric-detail')).toBeVisible();
  await page.waitForTimeout(400);
  const all = (await m(`${sel} [data-testid=metric-detail]`, 'facts'))!;
  const panelTree = (await m(`${sel} [data-testid=metric-detail]`, 'tree'))!;
  return {
    expected,
    collapsed,
    expanded,
    facts: all.filter((r) => r.region === 'facts'),
    eyebrow: all.filter((r) => r.region === 'eyebrow'),
    panelTree,
  };
}

const keyLike = (r: Regions): KeyRowReport[] => [
  ...r.expected,
  ...r.collapsed,
  ...r.expanded,
  ...r.facts,
  ...r.panelTree,
];
const label = (k: KeyRowReport) => `${k.region} ${k.key.slice(0, 24)}`;

for (const width of [1440, 1024, 390] as const) {
  for (const item of ['j-01', 'j-03'] as const) {
    test(`D2 at ${width} (${item}): keys are whole, exact and clear of their values`, async ({ page }) => {
      const r = await measure(page, width, item);
      const rows = keyLike(r);
      expect(r.expected.length, 'expected sections').toBeGreaterThanOrEqual(3);
      expect(r.collapsed.length, 'collapsed tree rows').toBeGreaterThanOrEqual(7);
      expect(r.expanded.length, 'open tree rows').toBeGreaterThanOrEqual(10);
      expect(r.facts.length, 'facts').toBeGreaterThanOrEqual(item === 'j-01' ? 5 : 2);

      for (const k of rows) {
        // D2-1: no ellipsis, nothing clipped, the text box is the scroll box, no nowrap
        expect(k.ellipsis, `${label(k)}: ellipsis`).toBe(false);
        expect(k.textOverflow, `${label(k)}: text-overflow`).not.toBe('ellipsis');
        expect(k.whiteSpace, `${label(k)}: white-space`).not.toBe('nowrap');
        expect(k.keyClipPx, `${label(k)}: clipped px`).toBe(0);
        expect(k.scrollOverflow, `${label(k)}: scroll box`).toBe(false);
        // D2-2: the key has a box
        expect(k.keyBoxW, `${label(k)}: box width`).toBeGreaterThan(0);
        // D2-3: nothing painted over the key, nothing of the key under a neighbour
        expect(k.overlapPx, `${label(k)}: over its value`).toBe(0);
        expect(k.overlapActPx, `${label(k)}: under its actions`).toBe(0);
        expect(k.valueOverActPx, `${label(k)}: value over actions`).toBe(0);
        // D2-9: not past its row
        expect(k.keyBeyondRowPx, `${label(k)}: past its row`).toBe(0);
        // D2-15: the rendered text (innerText applies text-transform) is the source key, in its own case
        expect(k.rendered, `${label(k)}: rendered text`).toBe(k.key);
        expect(ALL_KEYS.has(k.key) || /^\[\d+\]$/.test(k.key), `${label(k)}: a key of the fixture`).toBe(
          true,
        );
        expect(k.textTransform, `${label(k)}: text-transform`).toBe('none');
        // no title standing in for the text
        expect(k.hasTitle, `${label(k)}: title`).toBe(false);
      }

      // D2-4 and D2-5 (tree and sections)
      for (const k of [...r.expected, ...r.collapsed, ...r.expanded, ...r.panelTree]) {
        if (k.gapPx !== null) {
          expect(k.gapPx, `${label(k)}: gap`).toBeGreaterThanOrEqual(7.5);
          if (k.valueDir === 'rtl')
            expect(k.gapPx, `${label(k)}: RTL preview next to its key`).toBeLessThanOrEqual(14.5);
        }
      }
      if (width === 390)
        for (const k of r.collapsed.filter((x) => x.key.length >= 30))
          expect(k.valueBelowKey, `${label(k)}: the preview starts below a long key`).toBe(true);

      // D2-6: lines
      const lines = (xs: KeyRowReport[], len: number) =>
        xs.filter((k) => k.key.length === len).map((k) => k.keyLines);
      for (const k of rows) expect(k.keyLines, `${label(k)}: at most 4 lines`).toBeLessThanOrEqual(width === 390 ? 5 : 4);
      if (width >= 1024) {
        for (const k of [...r.expected, ...r.collapsed, ...r.expanded])
          expect(k.keyLines, `${label(k)}: one line at ${width}`).toBe(1);
        // the facts key column is 40% of a fact: 10 / 40 / 80 characters wrap to 1 / 2 / 4 lines
        expect(lines(r.facts, 10)).toEqual(item === 'j-01' ? [1] : []);
        expect(lines(r.facts, 40).every((n) => n === 2)).toBe(true);
        expect(lines(r.facts, 80).every((n) => n === 4)).toBe(true);
      } else {
        for (const set of [r.collapsed, r.expanded, r.expected, r.facts]) {
          expect(Math.max(0, ...lines(set, 10))).toBeLessThanOrEqual(1);
          expect(Math.max(0, ...lines(set, 40))).toBeLessThanOrEqual(2);
          // the tree breaks at words (<wbr>, round 7 review O2): its 80-character keys take 4 lines at 390 (3 before)
          // round 8b: 5 lines at 390 in the tree (the section panel took 30 px of the column), measured
          expect(Math.max(0, ...lines(set, 80))).toBeLessThanOrEqual(
            set === r.collapsed || set === r.expanded ? (width === 390 ? 5 : 4) : width === 390 ? 4 : 3,
          );
        }
      }

      // D2-7: density. A key and its preview on one line keep the 32px row (an Arabic line box is 34); a wrapped key is
      // lines x 18 + 14 (+18 when the preview stacks under it)
      for (const k of r.collapsed) {
        if (k.keyLines === 1 && k.valueBelowKey === false)
          expect(k.rowH, `${label(k)}: one-line row`).toBeLessThanOrEqual(
            k.valueDir === 'rtl' || k.keyDir === 'rtl' ? 35 : 33,
          );
        else if (k.keyLines > 1) {
          // (an Arabic line box is taller than a Latin one: up to 22px a line instead of 18)
          const per = k.keyDir === 'rtl' ? 22 : 18;
          const base = k.keyLines * 18 + 14 + (k.valueBelowKey ? 18 : 0);
          expect(k.rowH, `${label(k)}: wrapped row`).toBeGreaterThanOrEqual(base - 3);
          expect(k.rowH, `${label(k)}: wrapped row`).toBeLessThanOrEqual(base + (per - 18) * k.keyLines + 3);
        }
      }

      // D2-8: the actions of an open row stay on the key's line while the whole name fits beside them, else wrap under it
      const open = r.expanded.filter((k) => k.actionsOnOwnLine !== null);
      if (width === 1440)
        expect(open.filter((k) => k.actionsOnOwnLine).length, 'actions under the name at 1440').toBe(0);
      if (width === 1024)
        for (const k of open.filter((x) => x.actionsOnOwnLine))
          expect(k.key.length, `${label(k)}: only the longest names push the actions down`).toBeGreaterThan(
            50,
          );
      if (width === 390)
        for (const k of open.filter((x) => x.depth === 0 && x.key.length > 12 && x.key.length < 35))
          expect(k.actionsOnOwnLine, `${label(k)}: actions under the name`).toBe(true);

      // D2-10: facts. Side by side from 1024 (the panel is wider than 420px), stacked at 390
      for (const k of r.facts) {
        if (width >= 1024)
          expect(k.valueLeft! - k.keyRight, `${label(k)}: fact gap`).toBeGreaterThanOrEqual(11.5);
        else expect(k.valueTop! - k.keyBottom, `${label(k)}: stacked fact`).toBeGreaterThanOrEqual(1.5);
      }
      // D2-11: the prose label sits above its text and is never cut
      for (const k of r.eyebrow) {
        expect(k.ellipsis, `eyebrow ${k.key}`).toBe(false);
        expect(k.scrollOverflow, `eyebrow ${k.key}: scroll box`).toBe(false);
        expect(k.valueTop! - k.keyBottom, `eyebrow ${k.key}: above the text`).toBeGreaterThanOrEqual(1.5);
        expect(k.textTransform, 'the eyebrow keeps the one uppercase label style').toBe('uppercase');
      }

      // D2-12: Arabic keys, whole, at the inline start of their row, with their own direction
      const arabic = [...r.expected, ...r.collapsed, ...r.expanded, ...r.panelTree].filter((k) =>
        /[؀-ۿ]/.test(k.key),
      );
      if (item === 'j-03') expect(arabic.length, 'Arabic keys of j-03').toBeGreaterThanOrEqual(5);
      for (const k of arabic) {
        expect(k.keyDir, `${label(k)}: dir`).toBe('rtl');
        expect(k.keyLang, `${label(k)}: lang`).toBe('ar');
        expect(k.chevronRight, `${label(k)}: has a chevron`).not.toBeNull();
        expect(k.keyLeft - k.chevronRight!, `${label(k)}: key starts by the chevron`).toBeLessThanOrEqual(14);
        expect(k.keyLeft - k.chevronRight!, `${label(k)}: key starts by the chevron`).toBeGreaterThanOrEqual(
          0,
        );
      }
      // a fact key is a label anchored at the left of its column, in either script
      for (const k of r.facts)
        expect(Math.abs(k.keyLeft - k.keyBoxLeft), `${label(k)}: left-anchored`).toBeLessThanOrEqual(1.5);
    });
  }

  test(`D2-13 at ${width}: a tag's key comes before its value, whatever their scripts, and stays inside its row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openRun(page, s.slug, runId, 'item=j-03');
    const card = page.locator('[data-testid=item-card][data-item-id="j-03"]');
    await expect(card).toBeVisible();
    await page.waitForTimeout(400);
    const tags = await card.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('[data-part=key]'))
        .filter((k) => k.parentElement?.className.includes('tagText'))
        .map((k) => {
          const text = k.parentElement!;
          const tag = text.parentElement!;
          const value = text.querySelector<HTMLElement>('[data-part=value]')!;
          const row = tag.closest('[role=group]')!.getBoundingClientRect();
          const kr = k.getBoundingClientRect();
          const vr = value.getBoundingClientRect();
          const sameLine = Math.min(kr.bottom, vr.bottom) - Math.max(kr.top, vr.top) > 2;
          return {
            key: k.innerText,
            // (equal left edges: a key that wraps to two lines and a value that starts under its first line, as at 390 once the section panel narrowed the column)
            keyFirst: sameLine ? kr.left <= vr.left + 0.5 : kr.top < vr.top,
            insideRow: tag.getBoundingClientRect().right <= row.right + 0.5,
            rendered: k.innerText === (k.textContent ?? ''),
          };
        }),
    );
    expect(tags.length).toBe(3);
    expect(
      tags.some((t) => /[؀-ۿ]/.test(t.key)),
      'the Arabic tag key',
    ).toBe(true);
    for (const t of tags) {
      expect(t.keyFirst, `${t.key}: key before value`).toBe(true);
      expect(t.insideRow, `${t.key}: inside its row`).toBe(true);
      expect(ALL_KEYS.has(t.key), `${t.key}: exact key`).toBe(true);
    }
  });
}
