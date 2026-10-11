import type { ReactNode } from 'react';
import { ToggleButton, type ToggleButtonProps } from 'react-aria-components';
import { IconButton } from '../IconButton';
import styles from './Chip.module.css';

export interface ChipProps extends Omit<ToggleButtonProps, 'className' | 'style' | 'children'> {
  count?: number;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
  children: ReactNode;
}

/** Interactive filter chip: 26px rounded outline, sans 11px/600; counts mono. */
export function Chip({ count, onRemove, removeLabel, className, children, ...rest }: ChipProps) {
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <ToggleButton className={styles.chip} {...rest}>
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
