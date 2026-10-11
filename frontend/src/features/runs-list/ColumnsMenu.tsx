/** Columns popover: Run columns / Metrics / ⚡ System / ⚡ Trace stats (frozen-columns section dropped, decision §9.4). */
import { Button, Checkbox, Icon, Popover, Text } from '@/ui';
import type { ColumnDef, ColumnGroup } from './columns';
import styles from './ColumnsMenu.module.css';

const GROUPS: { id: ColumnGroup; label: string }[] = [
  { id: 'run', label: 'Run columns' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'system', label: '⚡ System' },
  { id: 'trace', label: '⚡ Trace stats' },
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
  const optional = all.filter((c) => c.visKey !== null);
  const shown = new Set(visible.map((c) => c.visKey).filter((k): k is string => k !== null));
  const toggle = (key: string) => {
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  return (
    <Popover label="Columns" trigger={<Button variant="neutral" iconEnd={<Icon name="chevron-down" size={12} />}>Columns</Button>}>
      <div className={styles.menu}>
        {GROUPS.filter((g) => !groups || groups.includes(g.id)).map((g) => {
          const cols = optional.filter((c) => c.group === g.id && c.id !== 'run');
          if (!cols.length) return null;
          return (
            <div key={g.id} className={styles.group}>
              <Text variant="sm" tone="muted" as="div" weight={650} className={styles.groupLabel}>
                {g.label}
              </Text>
              {cols.map((c) => (
                <Checkbox key={c.id} isSelected={shown.has(c.visKey!)} onChange={() => toggle(c.visKey!)} className={styles.option}>
                  {c.label}
                </Checkbox>
              ))}
            </div>
          );
        })}
        <Button variant="ghost" onPress={() => onChange(null)}>
          Reset to default
        </Button>
      </div>
    </Popover>
  );
}
