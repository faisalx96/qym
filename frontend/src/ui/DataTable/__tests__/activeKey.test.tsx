/**
 * cv4 X7: `activeKey` marks the page's current row (the item an open pane shows). It takes the focused-row highlight
 * and never moves DOM focus.
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from '..';

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: 'a', name: 'alpha' },
  { id: 'b', name: 'bravo' },
  { id: 'c', name: 'charlie' },
];

const table = (activeKey: string | null) => (
  <DataTable<Row>
    aria-label="t"
    columns={[{ id: 'name', header: 'Name', accessor: (r) => r.name }]}
    rows={ROWS}
    rowKey={(r) => r.id}
    activeKey={activeKey}
  />
);

const row = (c: HTMLElement, k: string) => c.querySelector<HTMLElement>(`tbody tr[data-row-key="${k}"]`)!;

describe('DataTable activeKey (cv4 X7)', () => {
  it('highlights the active row only, with aria-current, and does not move focus', () => {
    const { container, rerender } = render(table('b'));
    expect(row(container, 'b')).toHaveAttribute('data-focused');
    expect(row(container, 'b')).toHaveAttribute('data-active');
    expect(row(container, 'b')).toHaveAttribute('aria-current', 'true');
    expect(row(container, 'a')).not.toHaveAttribute('data-focused');
    expect(document.activeElement).toBe(document.body);
    rerender(table('c'));
    expect(row(container, 'c')).toHaveAttribute('data-focused');
    expect(row(container, 'b')).not.toHaveAttribute('data-focused');
    expect(document.activeElement).toBe(document.body);
  });

  it('a focused row does not take the highlight from the active row', () => {
    const { container } = render(table('b'));
    fireEvent.focus(row(container, 'a'));
    expect(row(container, 'a')).not.toHaveAttribute('data-focused');
    expect(row(container, 'b')).toHaveAttribute('data-focused');
  });

  it('is the Tab stop while no row was focused', () => {
    const { container } = render(table('c'));
    expect(row(container, 'c')).toHaveAttribute('tabindex', '0');
    expect(row(container, 'a')).toHaveAttribute('tabindex', '-1');
  });

  it('without an active row, the focused row is highlighted as before', () => {
    const { container } = render(table(null));
    fireEvent.focus(row(container, 'a'));
    expect(row(container, 'a')).toHaveAttribute('data-focused');
  });
});
