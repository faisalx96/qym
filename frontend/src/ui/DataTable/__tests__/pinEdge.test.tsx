/**
 * Redesign round 7 (Q1, D3): the boundary of the frozen columns is drawn by the frozen cells themselves.
 * No overlay element exists; the band cell next to the boundary carries the edge attribute; a row that is not laid out
 * in the columns (a detail row) has no pinned cell, so the line stops above it.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '..';

interface Row {
  id: string;
  name: string;
  a: string;
  b: string;
}
const ROWS: Row[] = [
  { id: 'r1', name: 'alpha', a: 'x', b: 'y' },
  { id: 'r2', name: 'bravo', a: 'x', b: 'y' },
];
const COLS: Column<Row>[] = [
  { id: 'name', header: 'Name', width: 160, pin: 'start', group: 'Run', accessor: (r) => r.name },
  { id: 'a', header: 'A', width: 120, group: 'Scores', accessor: (r) => r.a },
  { id: 'b', header: 'B', width: 120, group: 'Scores', accessor: (r) => r.b },
  { id: 'act', header: 'Act', width: 90, pin: 'end', accessor: () => 'go' },
];

afterEach(() => vi.unstubAllGlobals());

const table = (props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) => (
  <DataTable<Row> aria-label="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} {...props} />
);

describe('pinned boundary (round 7, Q1 and D3)', () => {
  it('renders no overlay element for a table with frozen columns on both sides', () => {
    const { container } = render(table());
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(0);
    // the pinned cells exist, the boundary is theirs
    expect(container.querySelectorAll('td[data-pin]').length).toBeGreaterThan(0);
  });

  it('puts data-pin-edge on the last start cell and the first end cell of the header and every body row', () => {
    const { container } = render(table());
    const edges = (side: string) =>
      Array.from(container.querySelectorAll(`[data-pin-edge="${side}"]`)).map((e) => e.tagName.toLowerCase());
    // header cell + band cell + 2 body cells per side
    expect(edges('start').sort()).toEqual(['td', 'td', 'th', 'th']);
    expect(edges('end').sort()).toEqual(['td', 'td', 'th', 'th']);
    expect(container.querySelector('td[data-pin-edge="start"]')).toHaveTextContent('alpha');
  });

  it('gives the band cell next to the boundary the edge attribute (and no other band cell)', () => {
    const { container } = render(table());
    const bands = Array.from(container.querySelectorAll<HTMLElement>('th[scope="colgroup"]'));
    expect(bands.length).toBeGreaterThan(0);
    const edged = bands.filter((b) => b.hasAttribute('data-pin-edge'));
    expect(edged.map((b) => [b.getAttribute('data-pin'), b.getAttribute('data-pin-edge')])).toEqual([
      ['start', 'start'],
      ['end', 'end'],
    ]);
  });

  it('leaves a detail row without a pinned cell, so the boundary stops above it', async () => {
    const { container, getAllByRole } = render(table({ renderExpanded: (r) => <p>detail {r.name}</p> }));
    const toggle = getAllByRole('button', { name: /expand/i })[0]!;
    toggle.click();
    const detail = await vi.waitFor(() => {
      const d = container.querySelector('tr[data-detail-row]');
      expect(d).not.toBeNull();
      return d!;
    });
    expect(detail.querySelectorAll('[data-pin], [data-pin-edge], [data-edge]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(0);
  });

  it('renders no pinned cell and no overlay in card mode', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 639px'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    const cols: Column<Row>[] = COLS.map((c, i) => ({ ...c, priority: i === 0 ? 1 : 2 }) as Column<Row>);
    const { container } = render(table({ columns: cols }));
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-pin], [data-pin-edge], [data-edge]')).toHaveLength(0);
  });

  it('keeps the scroll flags (the rail and other code read them) without styling a cell from them', () => {
    const { container } = render(table());
    const host = container.querySelector('[data-cues]');
    expect(host).not.toBeNull();
    expect(host?.hasAttribute('data-pin-start')).toBe(false); // the overlay's inputs are gone
    expect(host?.getAttribute('style') ?? '').not.toContain('--pin-');
  });
});
