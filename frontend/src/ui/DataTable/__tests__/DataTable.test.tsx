import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column, type Key } from '..';

interface Row {
  id: string;
  name: string;
  score: number;
}
const ROWS: Row[] = [
  { id: 'a', name: 'alpha', score: 0.9 },
  { id: 'b', name: 'bravo', score: 0.4 },
  { id: 'c', name: 'charlie', score: 0.7 },
];
const COLS: Column<Row>[] = [
  { id: 'name', header: 'Name', sort: 'name', width: 160 },
  { id: 'score', header: 'Score', type: 'score', sort: 'score', accessor: (r) => r.score, width: 140 },
];

function Harness(props: Partial<React.ComponentProps<typeof DataTable<Row>>>) {
  const [sel, setSel] = useState<Set<Key>>(new Set());
  return (
    <DataTable<Row>
      aria-label="Things"
      columns={COLS}
      rows={ROWS}
      rowKey={(r) => r.id}
      selection={{ selected: sel, onChange: setSel }}
      bulkActions={<button type="button">Delete</button>}
      {...props}
    />
  );
}

describe('DataTable v2', () => {
  it('has no axe violations (plain, selection, expansion)', async () => {
    const { container } = render(<Harness renderExpanded={(r) => <p>detail {r.name}</p>} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sorts itself client-side and cycles to unsorted', async () => {
    const user = userEvent.setup();
    render(<DataTable aria-label="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />);
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent);
    await user.click(screen.getByRole('button', { name: 'Score' }));
    expect(names()[0]).toContain('bravo');
    await user.click(screen.getByRole('button', { name: 'Score' }));
    expect(names()[0]).toContain('alpha');
    await user.click(screen.getByRole('button', { name: 'Score' }));
    expect(names()[0]).toContain('alpha');
    expect(screen.getAllByRole('columnheader')[1]).toHaveAttribute('aria-sort', 'none');
  });

  it('selects with range and shows the bulk bar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await user.click(boxes[0]!);
    expect(screen.getByRole('status')).toHaveTextContent('1 selected');
    await user.keyboard('{Shift>}');
    await user.click(boxes[2]!);
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('status')).toHaveTextContent('3 selected');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('expands with the keyboard and marks aria-expanded', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        aria-label="t"
        columns={COLS}
        rows={ROWS}
        rowKey={(r) => r.id}
        renderExpanded={(r) => <p>detail {r.name}</p>}
      />,
    );
    const row = screen.getAllByRole('row')[1]!;
    row.focus();
    await user.keyboard('{ArrowRight}');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('detail alpha')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('fits an expanded detail to the visible scroller width (detailFit)', async () => {
    const user = userEvent.setup();
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 640 });
    try {
      const { rerender } = render(
        <DataTable
          aria-label="t"
          columns={COLS}
          rows={ROWS}
          rowKey={(r) => r.id}
          renderExpanded={(r) => <p>detail {r.name}</p>}
        />,
      );
      screen.getAllByRole('row')[1]!.focus();
      await user.keyboard('{ArrowRight}');
      const hold = document.querySelector<HTMLElement>('[data-detail-hold]');
      expect(hold).not.toBeNull();
      expect(hold!.style.getPropertyValue('--scroller-w')).toBe('640px');
      rerender(
        <DataTable
          aria-label="t"
          columns={COLS}
          rows={ROWS}
          rowKey={(r) => r.id}
          detailFit="table"
          renderExpanded={(r) => <p>detail {r.name}</p>}
        />,
      );
      expect(document.querySelector('[data-detail-hold]')).toBeNull();
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('moves row focus with arrows and opens with Enter', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<DataTable aria-label="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} onRowOpen={open} />);
    screen.getAllByRole('row')[1]!.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(open).toHaveBeenCalledWith(ROWS[1]);
  });

  it('renders loading, empty, filtered-empty and error states with the header kept', () => {
    const { rerender } = render(
      <DataTable aria-label="t" columns={COLS} rows={[]} rowKey={(r) => r.id} loading />,
    );
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');
    rerender(<DataTable aria-label="t" columns={COLS} rows={[]} rowKey={(r) => r.id} empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    rerender(
      <DataTable
        aria-label="t"
        columns={COLS}
        rows={[]}
        rowKey={(r) => r.id}
        isFiltered
        empty="E"
        filteredEmpty={<p>No matches</p>}
      />,
    );
    expect(screen.getByText('No matches')).toBeInTheDocument();
    rerender(
      <DataTable aria-label="t" columns={COLS} rows={[]} rowKey={(r) => r.id} error={new Error('boom')} />,
    );
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it('groups with collapsible headers and aggregates', async () => {
    const user = userEvent.setup();
    const cols: Column<Row>[] = [
      COLS[0]!,
      {
        ...COLS[1]!,
        summary: (rows) => `avg ${(rows.reduce((n, r) => n + r.score, 0) / rows.length).toFixed(2)}`,
      },
    ];
    render(
      <DataTable
        aria-label="t"
        columns={cols}
        rows={ROWS}
        rowKey={(r) => r.id}
        groupBy={{ key: (r) => (r.score > 0.5 ? 'high' : 'low'), label: (k) => k, collapsible: true }}
      />,
    );
    const high = screen.getByRole('button', { name: 'Collapse group high' });
    expect(within(screen.getByRole('grid')).getByText('avg 0.80')).toBeInTheDocument();
    await user.click(high);
    expect(screen.queryByText('alpha')).toBeNull();
  });
});
