import { forwardRef, type ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import styles from './Button.module.css';

export type ButtonVariant = 'neutral' | 'accent' | 'danger' | 'ghost' | 'primary';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'style' | 'children'> {
  variant?: ButtonVariant;
  /** sm = 24px (toolbars, tables); md = 32px (dialog footers, page actions). */
  size?: ButtonSize;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * The one button. neutral/accent/danger = .qym-inline-action recipes;
 * primary = filled accent (.btn-primary); ghost = text only.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'neutral', size = 'sm', icon, iconEnd, loading, className, children, isDisabled, ...rest },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      className={[styles.button, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-loading={loading ? '' : undefined}
      data-icon-only={!children && (icon || iconEnd) ? '' : undefined}
      isDisabled={isDisabled || loading}
      {...rest}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : icon ? (
        <span className={styles.icon}>{icon}</span>
      ) : null}
      {children ? <span className={styles.label}>{children}</span> : null}
      {iconEnd ? <span className={styles.icon}>{iconEnd}</span> : null}
    </AriaButton>
  );
});
