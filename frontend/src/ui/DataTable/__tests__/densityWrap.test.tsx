/**
 * cv4 X6: a wrapping column follows the row density (compact 1 line, regular 2, comfortable 5). It does not force the
 * comfortable height at every density; a comfortable table with a wrapping column gets its own taller rows.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column, type Density } from '..';

interface Row {
  id: string;
  text: string;
}
const ROWS: Row[] = [{ id: 'r1', text: 'a long item text that wraps' }];

const table = (density: Density, wrap: Column<Row>['wrap'] = true, extra: Partial<Column<Row>> = {}) => (
  <DataTable<Row>
    aria-label="t"
    density={density}
    columns={[{ id: 'text', header: 'Text', accessor: (r) => r.text, wrap, ...extra }]}
    rows={ROWS}
    rowKey={(r) => r.id}
  />
);

const lines = (c: HTMLElement) =>
  (c.querySelector('[data-cell][data-wrap]') as HTMLElement | null)?.style.getPropertyValue('--lines');

describe('wrapping column by density (cv4 X6)', () => {
  it('clamps to 1, 2 and 5 lines', () => {
    expect(lines(render(table('compact')).container)).toBe('1');
    expect(lines(render(table('regular')).container)).toBe('2');
    expect(lines(render(table('comfortable')).container)).toBe('5');
  });

  it('a number caps the lines at every density', () => {
    expect(lines(render(table('compact', 3)).container)).toBe('1');
    expect(lines(render(table('comfortable', 3)).container)).toBe('3');
  });

  it('does not force the tall row; only a comfortable table with a wrapping column is taller', () => {
    for (const d of ['compact', 'regular'] as const) {
      const t = render(table(d)).container.querySelector('table')!;
      expect(t.hasAttribute('data-tall')).toBe(false);
      expect(t.hasAttribute('data-wrap-tall')).toBe(false);
    }
    expect(
      render(table('comfortable')).container.querySelector('table')!.hasAttribute('data-wrap-tall'),
    ).toBe(true);
  });

  it('a two-line (secondary) column still takes the tall row', () => {
    const t = render(table('regular', undefined, { secondary: () => 'sub' })).container.querySelector(
      'table',
    )!;
    expect(t.hasAttribute('data-tall')).toBe(true);
  });
});
