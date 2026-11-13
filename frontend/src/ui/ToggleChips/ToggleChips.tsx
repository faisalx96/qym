import type { ReactNode } from 'react';
import { Icon } from '../Icon';
import styles from './ToggleChips.module.css';

export interface ToggleChipOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** A number shown after the label (for example the number of values of a field). */
  count?: number;
  disabled?: boolean;
  title?: string;
}

export interface ToggleChipsProps<T extends string = string> {
  options: ToggleChipOption<T>[];
  /** The options that are on. */
  value: readonly T[];
  onChange: (next: T[]) => void;
  /** Names the group for assistive technology (for example "Metrics"). */
  'aria-label': string;
  /** The smallest number of options that stay on (default 0). The last ones on cannot be switched off. */
  min?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * ToggleChips (cv5 H4): a small set of options that are each on or off, all visible at one time. Use it in place of
 * a multi-select dropdown when the set is small (about 8 or fewer) and the person must see what is on. Each chip is
 * a button with `aria-pressed`. One choice out of several is `SegmentedControl`, not this.
 */
export function ToggleChips<T extends string = string>({
  options,
  value,
  onChange,
  min = 0,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: ToggleChipsProps<T>) {
  const on = new Set(value);
  const toggle = (v: T) => {
    if (on.has(v)) {
      if (on.size <= min) return;
      onChange(options.filter((o) => on.has(o.value) && o.value !== v).map((o) => o.value));
    } else {
      onChange(options.filter((o) => on.has(o.value) || o.value === v).map((o) => o.value));
    }
  };
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[styles.group, className].filter(Boolean).join(' ')}
      data-size={size}
      data-toggle-chips=""
    >
      {options.map((o) => {
        const pressed = on.has(o.value);
        const locked = pressed && on.size <= min;
        return (
          <button
            key={o.value}
            type="button"
            className={styles.chip}
            aria-pressed={pressed}
            aria-disabled={locked || undefined}
            disabled={o.disabled}
            title={o.title}
            data-value={o.value}
            onClick={() => toggle(o.value)}
          >
            <span className={styles.check} aria-hidden="true">
              {pressed ? <Icon name="check" size={12} /> : null}
            </span>
            <span className={styles.label}>{o.label}</span>
            {typeof o.count === 'number' ? <span className={styles.count}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
