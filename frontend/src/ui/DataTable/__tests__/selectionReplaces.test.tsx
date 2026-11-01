import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from '..';

/** Toolbar `selectionReplaces` (C228): the selection actions take the toolbar's place; its controls stay, hidden. */

interface Row {
  id: string;
}
const COLS: Column<Row>[] = [{ id: 'id', header: 'ID', width: 120, cell: (r) => r.id }];

function table(selected: string[]) {
  return render(
    <DataTable<Row>
      aria-label="Things"
      columns={COLS}
      rows={[{ id: 'a' }, { id: 'b' }]}
      rowKey={(r) => r.id}
      selection={{ selected: new Set(selected), onChange: () => undefined }}
      bulkActions={<button type="button">Delete {selected.length}</button>}
    >
      <DataTable.Toolbar selectionReplaces search={<input aria-label="Search things" />} />
    </DataTable>,
  );
}

describe('Toolbar selectionReplaces', () => {
  it('shows the toolbar controls while nothing is selected', () => {
    table([]);
    expect(screen.getByRole('textbox', { name: 'Search things' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Selection actions' })).toBeNull();
  });

  it('puts the selection actions in the toolbar place and hides the controls under them', () => {
    const { container } = table(['a', 'b']);
    const region = screen.getByRole('region', { name: 'Selection actions' });
    expect(region.textContent).toContain('2 selected');
    expect(screen.queryByRole('textbox', { name: 'Search things' })).toBeNull();
    expect(container.querySelector('[data-selection-replaces] [aria-hidden="true"] input')).toBeTruthy();
  });
});
