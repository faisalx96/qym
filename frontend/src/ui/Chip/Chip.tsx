import type { ReactNode } from 'react';
import { ToggleButton, type ToggleButtonProps } from 'react-aria-components';
import { IconButton } from '../IconButton';
import styles from './Chip.module.css';

export type ChipTone = 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'meta' | 'neutral';

export interface ChipProps extends Omit<ToggleButtonProps, 'className' | 'style' | 'children'> {
  count?: number;
  /** Selected colour from an information tone (e.g. a status filter). Default: the accent. */
  tone?: ChipTone;
  /** Selected colour from a series 1..8 (e.g. a category group). */
  series?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
  children: ReactNode;
}

/** Interactive filter chip: 26px rounded outline, sans 11px/600; counts mono. */
export function Chip({
  count,
  tone,
  series,
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <ToggleButton
        className={styles.chip}
        data-tone={series ? undefined : tone}
        data-series={series}
        {...rest}
      >
        <span>{children}</span>
        {typeof count === 'number' ? <span className={styles.count}>{count}</span> : null}
      </ToggleButton>
      {onRemove ? (
        <IconButton
          label={removeLabel ?? 'Remove filter'}
          icon="close"
          className={styles.remove}
          onPress={onRemove}
        />
      ) : null}
    </span>
  );
}
