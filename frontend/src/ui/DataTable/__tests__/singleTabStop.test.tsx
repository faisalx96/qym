import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '..';

/** One Tab stop for the rows (runs list C089 option A) and the 'Skip to pagination' button. */

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: 'a', name: 'alpha' },
  { id: 'b', name: 'bravo' },
];
const COLS: Column<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    width: 160,
    cell: (r) => (
      <>
        <a href={`#${r.id}`}>{r.name}</a> <button type="button">act on {r.name}</button>
      </>
    ),
  },
];

function table(singleTabStop: boolean) {
  return render(
    <DataTable<Row>
      aria-label="Things"
      columns={COLS}
      rows={ROWS}
      rowKey={(r) => r.id}
      singleTabStop={singleTabStop}
    >
      <DataTable.Footer
        pagination={{ total: 120, page: 1, pageSize: 50, noun: 'rows', onPageChange: vi.fn() }}
      />
    </DataTable>,
  );
}

describe('singleTabStop', () => {
  it('takes the controls inside rows out of the Tab order', () => {
    table(true);
    expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'act on bravo' })).toHaveAttribute('tabindex', '-1');
  });

  it('leaves rows alone when off', () => {
    table(false);
    expect(screen.getByRole('link', { name: 'alpha' })).not.toHaveAttribute('tabindex');
  });

  it('F2 moves focus into the focused row; Escape returns to the row and locks it again', async () => {
    const user = userEvent.setup();
    table(true);
    const row = screen.getAllByRole('row')[1]!;
    act(() => row.focus());
    await user.keyboard('{F2}');
    const link = screen.getByRole('link', { name: 'alpha' });
    expect(link).toHaveFocus();
    expect(link).not.toHaveAttribute('tabindex');
    await user.tab();
    expect(screen.getByRole('button', { name: 'act on alpha' })).toHaveFocus();
    // the other row stays locked
    expect(screen.getByRole('link', { name: 'bravo' })).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{Escape}');
    expect(row).toHaveFocus();
    expect(link).toHaveAttribute('tabindex', '-1');
  });

  it('Skip to pagination moves focus to the pager', async () => {
    const user = userEvent.setup();
    table(true);
    await user.click(screen.getByRole('button', { name: 'Skip to pagination' }));
    expect(document.activeElement?.closest('[data-dt-footer]')).not.toBeNull();
  });

  it('has no skip button when off', () => {
    table(false);
    expect(screen.queryByRole('button', { name: 'Skip to pagination' })).toBeNull();
  });
});
