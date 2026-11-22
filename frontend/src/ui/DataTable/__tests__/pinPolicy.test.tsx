/**
 * Feedback 17 Nov D3: only an identity column pins. The `#` column and every actions column scroll with the row:
 * the `rowActions` pseudo column is not pinned and shows its actions in place (no fold handle), and no feature table
 * declares an end pin or pins its number column.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from '..';

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: 'r1', name: 'alpha' },
  { id: 'r2', name: 'bravo' },
];
const COLS: Column<Row>[] = [
  { id: 'index', header: '#', type: 'number', width: 64, accessor: (r) => r.id },
  { id: 'name', header: 'Name', width: 160, pin: 'start', accessor: (r) => r.name },
];

describe('pin policy (feedback 17 Nov D3)', () => {
  it('does not pin the row actions column and shows its actions without a fold handle', () => {
    const { container } = render(
      <DataTable<Row>
        aria-label="t"
        columns={COLS}
        rows={ROWS}
        rowKey={(r) => r.id}
        rowActions={() => [{ id: 'del', label: 'Delete', danger: true, onPress: () => {} }]}
      />,
    );
    const cells = Array.from(container.querySelectorAll('td[data-pseudo="actions"]'));
    expect(cells).toHaveLength(2);
    for (const td of cells) {
      expect(td.hasAttribute('data-pin')).toBe(false);
      expect(td.hasAttribute('data-fold')).toBe(false);
      expect(td.querySelector('button[aria-label="Delete"]')).not.toBeNull();
    }
    // the identity column keeps its pin, the number column has none
    expect(container.querySelector('td[data-col="name"]')?.getAttribute('data-pin')).toBe('start');
    expect(container.querySelector('td[data-col="index"]')?.hasAttribute('data-pin')).toBe(false);
  });

  it('no shipped feature table pins a column at the end (the dev galleries may)', () => {
    const root = join(__dirname, '../../../features');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'dev') walk(path);
        } else if (/\.tsx?$/.test(name) && /\bpin:\s*['"]end['"]/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
