import { Button } from '../Button';
import { Chip } from '../Chip';
import { Text } from '../Text';
import styles from './QuickFilterGroup.module.css';

export interface QuickFilterOption {
  id: string;
  label: string;
  count?: number;
  tone?: 'success' | 'danger' | 'warning';
}

export interface QuickFilterGroupProps {
  label: string;
  /** single: at most one option is on (toggling the on option turns it off); multi: any number. */
  mode: 'single' | 'multi';
  options: QuickFilterOption[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Adds an "Only" action to each option (select just this one). */
  onOnly?: (id: string) => void;
}

/** A labelled group of filter chips for the quick-filter sidebar. */
export function QuickFilterGroup({
  label,
  mode,
  options,
  selected,
  onToggle,
  onOnly,
}: QuickFilterGroupProps) {
  if (!options.length) return null;
  const on = new Set(selected);
  return (
    <div className={styles.group} role="group" aria-label={label} data-mode={mode}>
      <Text variant="sm" tone="muted" weight={650} className={styles.label}>
        {label}
      </Text>
      <div className={styles.options}>
        {options.map((o) => (
          <span key={o.id} className={styles.option} data-tone={o.tone}>
            <Chip count={o.count} isSelected={on.has(o.id)} onChange={() => onToggle(o.id)}>
              {o.label}
            </Chip>
            {onOnly ? (
              <Button
                size="sm"
                variant="ghost"
                className={styles.only}
                aria-label={`Only ${o.label}`}
                onPress={() => onOnly(o.id)}
              >
                Only
              </Button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
