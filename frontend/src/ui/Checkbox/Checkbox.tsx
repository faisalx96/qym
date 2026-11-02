import type { ReactNode } from 'react';
import { Checkbox as AriaCheckbox, type CheckboxProps as AriaCheckboxProps } from 'react-aria-components';
import { Icon } from '../Icon';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<AriaCheckboxProps, 'className' | 'style' | 'children'> {
  children?: ReactNode;
  className?: string;
  /** Visually hidden label (still announced). */
  hideLabel?: boolean;
}

export function Checkbox({ children, className, hideLabel, ...rest }: CheckboxProps) {
  return (
    <AriaCheckbox className={[styles.checkbox, className].filter(Boolean).join(' ')} {...rest}>
      {({ isSelected, isIndeterminate }) => (
        <>
          <span className={styles.box} aria-hidden="true">
            {isIndeterminate ? (
              <Icon name="minus" size={12} />
            ) : isSelected ? (
              <Icon name="check" size={12} />
            ) : null}
          </span>
          {children ? (
            <span className={styles.label} data-hidden={hideLabel ? '' : undefined}>
              {children}
            </span>
          ) : null}
        </>
      )}
    </AriaCheckbox>
  );
}
