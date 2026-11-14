/// <reference lib="dom" />
/**
 * Redesign round 7, D2 (docs/internal/ui-migration/redesign7/qa.md): the name of a JSON key is always fully visible and
 * never overlaps its value. Items j-01 (English) and j-03 (Arabic) of the `seedR7JsonKeys` run at 1440 / 1024 / 390, in
 * the item pane: the fields of Expected and Output, the details of the `schema_judge` metric and the item metadata.
 *
 * The pane shows each key above its value (pane/values.tsx `FieldList`). The criteria that measured the old key tree
 * (D2-4 / D2-5 gap between a key and its preview, D2-6 line counts, D2-7 row heights, D2-8 row actions, the chevron of
 * D2-12) and the facts columns and the prose label of the old metric panel (D2-10, D2-11) went away with those parts.
 * D2-1, D2-2, D2-3, D2-9, D2-12 (direction of an Arabic key), D2-13 and D2-15 stay.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { keyProbe, type KeyRowReport } from './keysProbe';
import { R7_KEYS, r7AllKeys } from './seed';
import { itemPane, openMetric, openRun, paneBlock, seedJsonKeys, seedProject, type Seeded } from './support';

let s: Seeded;
let runId: string;
const ALL_KEYS = r7AllKeys();
const ARABIC = /[؀-ۿ]/;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r7-keys');
  runId = await seedJsonKeys(s);
});

interface Regions {
  expected: KeyRowReport[];
  output: KeyRowReport[];
  details: KeyRowReport[];
  metadata: KeyRowReport[];
}

async function openItemPane(page: Page, width: number, item: string): Promise<Locator> {
  await page.setViewportSize({ width, height: 1000 });
  await openRun(page, s.slug, runId, `item=${item}`);
  const pane = itemPane(page, item);
  await expect(pane).toBeVisible();
  await expect(paneBlock(pane, 'output')).toBeVisible();
  return pane;
}

async function measure(page: Page, width: number, item: string): Promise<Regions> {
  const pane = await openItemPane(page, width, item);
  // the details of a metric are closed until the reader opens them
  await openMetric(pane, 'schema_judge');
  await page.waitForTimeout(400);
  const sel = `[data-testid=item-pane][data-item-id="${item}"]`;
  const m = async (root: string) => (await page.evaluate(keyProbe, `${sel} ${root}`)) ?? [];
  return {
    expected: await m('section[data-part=expected]'),
    output: await m('section[data-part=output]'),
    details: await m('[data-part=metric-details]'),
    metadata: await m('[data-part=metadata]'),
  };
}

const label = (region: string, k: KeyRowReport) => `${region} ${k.key.slice(0, 24)}`;

for (const width of [1440, 1024, 390] as const) {
  for (const item of ['j-01', 'j-03'] as const) {
    test(`D2 at ${width} (${item}): keys are whole, exact and clear of their values`, async ({ page }) => {
      const r = await measure(page, width, item);
      expect(r.expected.length, 'expected keys').toBeGreaterThanOrEqual(3);
      expect(r.output.length, 'output keys (every depth)').toBeGreaterThanOrEqual(7);
      expect(r.details.length, 'metric detail keys').toBeGreaterThanOrEqual(item === 'j-01' ? 5 : 2);
      expect(r.metadata.length, 'item metadata keys').toBe(4);
      // the reason text is in the Reason column of the metric row, not a key of the details
      expect(r.details.map((k) => k.key)).not.toContain('reasoning');
      // the long keys of the fixture are there
      if (item === 'j-01') {
        expect(r.output.map((k) => k.key)).toEqual(
          expect.arrayContaining([R7_KEYS.k10, R7_KEYS.k40, R7_KEYS.k80, R7_KEYS.c40, R7_KEYS.c80]),
        );
        expect(r.details.map((k) => k.key)).toEqual(expect.arrayContaining([R7_KEYS.k40, R7_KEYS.k80]));
      } else {
        expect(r.output.map((k) => k.key)).toContain(R7_KEYS.ar);
      }

      for (const [region, rows] of Object.entries(r) as Array<[string, KeyRowReport[]]>) {
        for (const k of rows) {
          // D2-1: no ellipsis, nothing clipped, the text box is the scroll box, no nowrap
          expect(k.ellipsis, `${label(region, k)}: ellipsis`).toBe(false);
          expect(k.textOverflow, `${label(region, k)}: text-overflow`).not.toBe('ellipsis');
          expect(k.whiteSpace, `${label(region, k)}: white-space`).not.toBe('nowrap');
          expect(k.keyClipPx, `${label(region, k)}: clipped px`).toBe(0);
          expect(k.scrollOverflow, `${label(region, k)}: scroll box`).toBe(false);
          // D2-2: the key has a box
          expect(k.keyBoxW, `${label(region, k)}: box width`).toBeGreaterThan(0);
          // D2-3: the key is above its value, nothing painted over it
          expect(k.overlapPx, `${label(region, k)}: over its value`).toBe(0);
          if (k.valueBelowKey !== null)
            expect(k.valueBelowKey, `${label(region, k)}: the value starts below the key`).toBe(true);
          // D2-9: not past its field
          expect(k.keyBeyondRowPx, `${label(region, k)}: past its field`).toBe(0);
          // D2-15: the rendered text is the source key, in its own case
          expect(k.rendered, `${label(region, k)}: rendered text`).toBe(k.key);
          expect(k.textTransform, `${label(region, k)}: text-transform`).toBe('none');
          expect(ALL_KEYS.has(k.key), `${label(region, k)}: a key of the fixture`).toBe(true);
          // no title standing in for the text
          expect(k.hasTitle, `${label(region, k)}: title`).toBe(false);
          // D2-12: an Arabic key has its own direction and language
          if (ARABIC.test(k.key)) {
            expect(k.keyDir, `${label(region, k)}: dir`).toBe('rtl');
            expect(k.keyLang, `${label(region, k)}: lang`).toBe('ar');
          }
        }
      }
      const arabic = [...r.expected, ...r.output, ...r.details].filter((k) => ARABIC.test(k.key));
      if (item === 'j-03') expect(arabic.length, 'Arabic keys of j-03').toBeGreaterThanOrEqual(5);
    });
  }

  test(`D2-13 at ${width}: an item metadata key comes before its value, whatever their scripts, and stays inside the pane`, async ({
    page,
  }) => {
    const pane = await openItemPane(page, width, 'j-03');
    const tags = await pane.locator('[data-part="metadata"]').evaluate((el) => {
      const paneBox = el.closest('[data-testid=item-pane]')!.getBoundingClientRect();
      return Array.from(el.querySelectorAll<HTMLElement>('dt[data-part=key]')).map((k) => {
        const value = k.nextElementSibling as HTMLElement;
        const kr = k.getBoundingClientRect();
        const vr = value.getBoundingClientRect();
        return {
          key: k.textContent ?? '',
          // the key is above its value in the field
          keyFirst: kr.top < vr.top,
          inside: kr.left >= paneBox.left - 0.5 && Math.max(kr.right, vr.right) <= paneBox.right + 0.5,
          rendered: k.innerText === (k.textContent ?? ''),
        };
      });
    });
    expect(tags.length).toBe(4);
    expect(
      tags.some((t) => ARABIC.test(t.key)),
      'the Arabic metadata key',
    ).toBe(true);
    for (const t of tags) {
      expect(t.keyFirst, `${t.key}: key before value`).toBe(true);
      expect(t.inside, `${t.key}: inside the pane`).toBe(true);
      expect(t.rendered, `${t.key}: as written`).toBe(true);
      expect(ALL_KEYS.has(t.key), `${t.key}: exact key`).toBe(true);
    }
  });
}
