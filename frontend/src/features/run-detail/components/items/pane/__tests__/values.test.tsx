/** The value view of the item pane: table detection, the fields of a JSON value in the JSON viewer's kinds, raw JSON, the fold. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FOLD_LINES, Value, detailIsCompact, isLongText, tableOf } from '../values';

describe('tableOf', () => {
  it('reads a list of like objects as a table, with the union of their keys', () => {
    const t = tableOf([
      { id: 1, name: 'a' },
      { id: 2, city: 'x' },
    ])!;
    expect(t.columns).toEqual(['id', 'name', 'city']);
    expect(t.rows).toHaveLength(2);
    expect(t.total).toBe(2);
  });
  it('reads {columns, rows} with rows as arrays', () => {
    const t = tableOf({
      columns: ['a', 'b'],
      rows: [
        [1, 'x'],
        [2, 'y'],
      ],
    })!;
    expect(t.columns).toEqual(['a', 'b']);
    expect(t.rows[1]).toEqual({ a: 2, b: 'y' });
  });
  it('refuses a scalar list, an empty list, a plain object and a list with a nested value', () => {
    expect(tableOf([1, 2, 3])).toBeNull();
    expect(tableOf([])).toBeNull();
    expect(tableOf({ a: 1 })).toBeNull();
    expect(tableOf([{ a: { b: 1 } }])).toBeNull();
  });
});

describe('detailIsCompact', () => {
  it('is true for short facts only', () => {
    expect(detailIsCompact({ judge: 'gpt-4.1', duration_ms: 12, tags: ['a', 'b'] })).toBe(true);
    expect(detailIsCompact({ rows: [{ a: 1 }] })).toBe(false);
    expect(
      detailIsCompact({
        note: 'A long sentence that explains at length why the answer was not the right one.',
      }),
    ).toBe(false);
  });
});

describe('Value', () => {
  it('shows plain text as prose', () => {
    render(<Value value="Plain answer" label="Output" />);
    expect(screen.getByText('Plain answer')).toBeTruthy();
    expect(document.querySelector('dl')).toBeNull();
  });

  it('shows each key of a JSON value above its value, the value in the kind of the JSON viewer', () => {
    render(
      <Value
        value={JSON.stringify({ channel: 'chat', count: 3, vip: true, note: null, user: { id: 'u1' } })}
        label="Input"
      />,
    );
    const list = screen.getByLabelText('Input');
    const keys = Array.from(list.querySelectorAll('[data-part="key"]')).map((k) => k.textContent);
    expect(keys.slice(0, 4)).toEqual(['channel', 'count', 'vip', 'note']);
    const kind = (text: string) => within(list).getByText(text).getAttribute('data-kind');
    expect(kind('chat')).toBe('string');
    expect(kind('3')).toBe('number');
    expect(kind('true')).toBe('boolean');
    expect(kind('null')).toBe('null');
    // a nested object is a group of fields under its key
    expect(list.querySelector('dl[data-nested]')).not.toBeNull();
    expect(within(list).getByText('1 field')).toBeTruthy();
  });

  it('shows a list of like objects as a table and a query as code', () => {
    render(
      <Value
        value={{
          rows: [
            { sku: 'A-1', qty: 2 },
            { sku: 'B-2', qty: 5 },
          ],
          sql: 'select sku from stock where qty > 1',
        }}
        label="Output"
      />,
    );
    // the platform table (DataTable), named by its key
    expect(document.querySelector('[data-shape="table"] [aria-label="rows"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-shape="table"] tbody tr')).toHaveLength(2);
    expect(screen.getByText('2 rows')).toBeTruthy();
    const code = document.querySelector('pre[data-lang="sql"]')!;
    expect(code.textContent).toBe('select sku\nfrom stock\nwhere qty > 1');
    expect(Array.from(code.querySelectorAll('[data-t="keyword"]')).map((k) => k.textContent)).toEqual([
      'select',
      'from',
      'where',
    ]);
  });

  it('shows the raw JSON with a token class for each kind (the --json-* colours)', () => {
    render(<Value value={{ a: 'x', n: 1, ok: false, none: null }} label="Input" raw />);
    const pre = screen.getByLabelText('Input, raw JSON');
    expect(pre.getAttribute('data-lang')).toBe('json');
    const kinds = new Set(Array.from(pre.querySelectorAll('[data-t]')).map((n) => n.getAttribute('data-t')));
    expect([...kinds].sort()).toEqual(['boolean', 'key', 'null', 'number', 'punct', 'string']);
    expect(document.querySelector('dl')).toBeNull();
  });

  it('marks the words of an output that Expected does not have', () => {
    render(
      <Value
        value="Refunds take 7 days in total"
        other="Refunds take 3 days in total"
        side="after"
        label="Output"
      />,
    );
    const marks = Array.from(document.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual(['7']);
  });

  it('says so when nothing was recorded', () => {
    render(<Value value="" label="Output" />);
    expect(screen.getByText('Nothing was recorded')).toBeTruthy();
  });
});

describe('the fold of a very long value', () => {
  it('knows a long text by its lines or by its length', () => {
    expect(isLongText('short')).toBe(false);
    expect(isLongText(Array.from({ length: FOLD_LINES + 1 }, () => 'x').join('\n'))).toBe(true);
    expect(isLongText('x'.repeat(FOLD_LINES * 60 + 1))).toBe(true);
  });

  it('shows a text up to the fold in full, with no button', () => {
    render(<Value value={'A line of text.\n'.repeat(10)} label="Output" />);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('folds a longer text behind Show more and opens it', () => {
    render(<Value value={'A line of text.\n'.repeat(FOLD_LINES + 20)} label="Output" />);
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-folded]')).not.toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-folded]')).toBeNull();
  });
});
