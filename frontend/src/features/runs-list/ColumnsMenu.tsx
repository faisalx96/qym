/** Columns popover: Run columns / Metrics / ⚡ System / ⚡ Trace stats (frozen-columns section dropped, decision §9.4). */
import { useState } from 'react';
import { Button, Checkbox, Icon, Popover, SearchField, Text } from '@/ui';
import type { ColumnDef, ColumnGroup } from './columns';
import styles from './ColumnsMenu.module.css';

const GROUPS: { id: ColumnGroup; label: string }[] = [
  { id: 'run', label: 'Run columns' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'system', label: '⚡ System' },
  { id: 'trace', label: '⚡ Trace stats' },
  { id: 'group', label: 'Group stats' },
];

export function ColumnsMenu({
  all,
  visible,
  onChange,
  groups,
}: {
  groups?: ColumnGroup[];
  all: ColumnDef[];
  visible: ColumnDef[];
  /** `null` = reset to the default set. */
  onChange: (keys: Set<string> | null) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  // The Run column is always shown (decision 9.4), so it is not offered.
  const optional = all.filter((c) => c.visKey !== null && c.id !== 'run');
  const listed = optional.filter(
    (c) => (!groups || groups.includes(c.group)) && (!needle || c.label.toLowerCase().includes(needle)),
  );
  const shown = new Set(visible.map((c) => c.visKey).filter((k): k is string => k !== null));
  const toggle = (key: string) => {
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  // All / None act on what the search lists.
  const setListed = (on: boolean) => {
    const next = new Set(shown);
    for (const c of listed) {
      if (on) next.add(c.visKey!);
      else next.delete(c.visKey!);
    }
    onChange(next);
  };
  return (
    <Popover
      label="Columns"
      trigger={
        <Button variant="neutral" iconEnd={<Icon name="chevron-down" size={12} />}>
          Columns
        </Button>
      }
    >
      <div className={styles.tools}>
        <SearchField
          label="Search columns"
          placeholder="Search columns…"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
        />
        <Button variant="ghost" onPress={() => setListed(true)}>
          All
        </Button>
        <Button variant="ghost" onPress={() => setListed(false)}>
          None
        </Button>
      </div>
      <div className={styles.menu}>
        {GROUPS.filter((g) => !groups || groups.includes(g.id)).map((g) => {
          const cols = listed.filter((c) => c.group === g.id);
          if (!cols.length) return null;
          return (
            <div key={g.id} className={styles.group}>
              <Text variant="sm" tone="muted" as="div" weight={650} className={styles.groupLabel}>
                {g.label}
              </Text>
              {cols.map((c) => (
                <Checkbox
                  key={c.id}
                  isSelected={shown.has(c.visKey!)}
                  onChange={() => toggle(c.visKey!)}
                  className={styles.option}
                >
                  {c.label}
                </Checkbox>
              ))}
            </div>
          );
        })}
        {listed.length === 0 ? (
          <Text variant="sm" tone="muted" as="p">
            No columns match.
          </Text>
        ) : null}
        <Button variant="ghost" onPress={() => onChange(null)}>
          Reset to default
        </Button>
      </div>
    </Popover>
  );
}
