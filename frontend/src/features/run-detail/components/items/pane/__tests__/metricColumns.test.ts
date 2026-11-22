/**
 * I13 (November 2026): the metrics table of the item pane fell apart (every cell in one column). Its column template
 * was put together in CSS from custom properties that could be empty or missing (`--scores` inside `repeat()`,
 * `--c-passif`, `--c-reason`); React drops a style value of `' '`, so the property went missing and the whole
 * `grid-template-columns` was invalid. The templates are now written out in TypeScript, and the stylesheet only reads
 * the one template, with a one-column fallback. The same holds for the two tables of the compare pane.
 *
 * I16 (November 2026): one line per metric at every width. There is one template (no narrow or tiny stacked layout);
 * every track has a smallest width, and `min` is their sum, the width the pane grows to (up to 75% of the page).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { byMetricColumns, byRunColumns } from '../../../../../compare/components/items/pane/ComparePane';
import { columnStyle, metricColumns } from '../metrics';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../../../../..');
const css = (p: string) =>
  readFileSync(join(SRC, p), 'utf-8')
    // comments may name the old properties
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** The number of tracks a template makes, with `repeat(n, x)` counted as n. */
function tracks(template: string): number {
  let rest = template;
  let n = 0;
  rest = rest.replace(/repeat\((\d+),\s*((?:[^()]|\([^()]*\))+)\)/g, (_, k: string) => {
    n += Number(k);
    return '';
  });
  rest = rest.replace(/minmax\([^()]*\)/g, 'X');
  return n + rest.trim().split(/\s+/).filter(Boolean).length;
}

describe('metricColumns', () => {
  const combos = [false, true].flatMap((multi) =>
    [1, 2, 3, 4].flatMap((scores) =>
      [false, true].flatMap((passIf) => [false, true].map((reason) => ({ multi, scores, passIf, reason }))),
    ),
  );

  it.each(combos)('writes out every track: %o', (input) => {
    const cols = metricColumns(input);
    // the arrow, the name, the scores, Pass if, the reason, the action column: always on one line
    const want = 3 + input.scores + (input.passIf ? 1 : 0) + (input.reason ? 1 : 0);
    expect(tracks(cols.template)).toBe(want);
    expect(cols.tracks).toBe(want);
    expect(cols.template).not.toContain('var(');
    expect(cols.template).toMatch(/^24px .+ 24px$/);
    expect(cols.template).not.toMatch(/\s{2,}/);
    // no track may shrink to nothing: a score never goes narrower than its pill, the name never under its floor
    expect(cols.template).not.toMatch(/minmax\(0,/);
  });

  it('adds up the smallest width of every track', () => {
    // 24 + 148 + 3 x 68 + 64 + 24
    expect(metricColumns({ multi: true, scores: 3, passIf: true, reason: false }).min).toBe(464);
    // 24 + 148 + 68 + 200 + 24
    expect(metricColumns({ multi: false, scores: 1, passIf: false, reason: true }).min).toBe(464);
    // 24 + 148 + 2 x 68 + 64 + 200 + 24
    expect(metricColumns({ multi: true, scores: 2, passIf: true, reason: true }).min).toBe(596);
  });

  it('keeps the templates the wide table had, with a floor under the reason', () => {
    expect(metricColumns({ multi: true, scores: 4, passIf: true, reason: false }).template).toBe(
      '24px minmax(148px, 1.4fr) repeat(4, minmax(68px, 1fr)) 64px 24px',
    );
    expect(metricColumns({ multi: false, scores: 1, passIf: true, reason: true }).template).toBe(
      '24px minmax(148px, 0.8fr) repeat(1, 68px) 64px minmax(200px, 2fr) 24px',
    );
  });

  it('makes the name column as wide as the longest name, between 148px and 360px', () => {
    const at = (name: number | undefined) =>
      metricColumns({ multi: true, scores: 3, passIf: true, reason: false, name });
    // a short name keeps the floor, and so does a width that could not be measured
    expect(at(90).min).toBe(464);
    expect(at(undefined).min).toBe(464);
    expect(at(Number.NaN).min).toBe(464);
    // a long name: the track and the width the pane grows to follow it
    expect(at(201.3).template).toBe('24px minmax(202px, 1.4fr) repeat(3, minmax(68px, 1fr)) 64px 24px');
    expect(at(201.3).min).toBe(464 - 148 + 202);
    // a very long name stops at the cap and wraps
    expect(at(900).template).toContain('minmax(360px, 1.4fr)');
    expect(at(900).min).toBe(464 - 148 + 360);
  });

  it('never writes a broken count', () => {
    for (const scores of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2.7]) {
      const { template } = metricColumns({ multi: true, scores, passIf: false, reason: false });
      expect(template).toMatch(/repeat\([1-9]\d*, /);
    }
  });

  it('hands the template to the stylesheet as one property', () => {
    const cols = metricColumns({ multi: false, scores: 1, passIf: false, reason: false });
    const style = columnStyle(cols) as Record<string, string>;
    expect(style).toEqual({ '--m-cols': cols.template });
  });
});

describe('the compare pane columns', () => {
  it('writes one track per run and per metric', () => {
    expect(byMetricColumns(3)).toBe('24px minmax(132px, 184px) repeat(3, minmax(160px, 1fr))');
    expect(byRunColumns(2)).toBe('24px minmax(200px, 1.6fr) repeat(2, minmax(84px, 1fr))');
    for (const n of [0, -2, Number.NaN]) {
      expect(byMetricColumns(n)).toMatch(/repeat\(1, /);
      expect(byRunColumns(n)).toMatch(/repeat\(1, /);
    }
  });
});

describe('source guard: no grid template built from an optional property (I13)', () => {
  const files = [
    'features/run-detail/components/items/pane/pane.module.css',
    'features/compare/components/items/pane/comparePane.module.css',
  ];

  it.each(files)('%s', (file) => {
    const text = css(file);
    // the old column properties are gone
    expect(text).not.toMatch(/--(scores|c-passif|c-reason|runs|metrics)\b/);
    // a count from a property inside repeat() fails as a whole when the property is missing
    expect(text).not.toMatch(/repeat\(\s*var\(/);
    // an empty fallback (`var(--x,)`) is an optional track: never in a template
    expect(text).not.toMatch(/var\(--[\w-]+\s*,\s*\)/);
    // every property a template reads has a fallback of its own
    for (const [, value] of text.matchAll(/grid-template-columns\s*:\s*([^;]+);/g)) {
      for (const [, after] of value!.matchAll(/var\(--[\w-]+\s*(.)/g)) {
        expect(after, `${file}: ${value}`).toBe(',');
      }
    }
  });

  it('the metrics grid reads the written-out template, never one built in CSS', () => {
    const text = css(files[0]!);
    // the sheet only sets the one-column frame of the loading state; the template itself comes from metrics.tsx
    for (const [, value] of text.matchAll(/--m-cols\s*:\s*([^;]+);/g)) {
      expect(value!.trim()).toBe('minmax(0, 1fr)');
    }
    // the stacked layouts are gone (I16): no narrow or tiny template, no container query that changes the columns
    expect(text).not.toMatch(/--m-(wide|narrow|tiny)\b/);
    expect(text).not.toMatch(/@container\s+metrics\s*\(/);
  });
});
