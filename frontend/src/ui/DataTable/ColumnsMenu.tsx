import { useMemo, useState } from 'react';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { SearchField } from '../SearchField';
import { headerText } from './model';
import type { Column } from './types';
import type { DataTableModel } from './useDataTableModel';
import styles from './DataTable.module.css';

/** Columns popover: search, group sections, All / None, Reset. Used by the toolbar and standalone. */
export function ColumnsMenu<R>({
  columns,
  model,
  label = 'Columns',
}: {
  columns: Column<R>[];
  model: DataTableModel;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const hideable = columns.filter((c) => c.hideable !== false && !c.id.startsWith('__'));
  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, Column<R>[]>();
    for (const c of hideable) {
      if (needle && !headerText(c).toLowerCase().includes(needle)) continue;
      const key = c.group ?? '';
      out.set(key, [...(out.get(key) ?? []), c]);
    }
    return [...out];
  }, [hideable, q]);
  const shown = hideable.filter((c) => !model.hidden.has(c.id)).length;
  return (
    <Popover
      label={label}
      trigger={
        <Button
          icon={<Icon name="list" size={12} />}
          aria-label={`${label} (${shown} of ${hideable.length} shown)`}
        >
          {label}
        </Button>
      }
    >
      <div className={styles.colMenu}>
        <SearchField label="Search columns" value={q} onChange={setQ} placeholder="Search columns" />
        <div className={styles.colMenuBulk}>
          <Button variant="ghost" onPress={() => model.setAllHidden(false)}>
            All
          </Button>
          <Button variant="ghost" onPress={() => model.setAllHidden(true)}>
            None
          </Button>
          <Button variant="ghost" onPress={model.resetColumns}>
            Reset
          </Button>
        </div>
        <div className={styles.colMenuList}>
          {sections.length === 0 ? <p className={styles.colMenuEmpty}>No matching columns</p> : null}
          {sections.map(([group, list]) => (
            <fieldset key={group || '_'} className={styles.colMenuGroup}>
              {group ? <legend className={styles.colMenuLegend}>{group}</legend> : null}
              {list.map((c) => (
                <Checkbox
                  key={c.id}
                  isSelected={!model.hidden.has(c.id)}
                  onChange={(on) => model.setHidden(c.id, !on)}
                >
                  {headerText(c)}
                </Checkbox>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
    </Popover>
  );
}
