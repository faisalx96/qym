import { forwardRef, useId, type ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import styles from './Button.module.css';

export type ButtonVariant = 'neutral' | 'accent' | 'danger' | 'ghost' | 'primary' | 'meta';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'style' | 'children'> {
  variant?: ButtonVariant;
  /** sm = 24px, every button by default; md = 32px, and only in a dialog footer (C049: one size per role). */
  size?: ButtonSize;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  loading?: boolean;
  /** Why the button is disabled: shown on hover and read with the button (C166), e.g. 'No changes to save'. */
  disabledReason?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * The one button. neutral/accent/danger = .qym-inline-action recipes;
 * primary = filled accent (.btn-primary); ghost = text only.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'neutral',
    size = 'sm',
    icon,
    iconEnd,
    loading,
    disabledReason,
    className,
    children,
    isDisabled,
    ...rest
  },
  ref,
) {
  const reasonId = useId();
  const reason = isDisabled && !loading && disabledReason ? disabledReason : null;
  const button = (
    <AriaButton
      ref={ref}
      className={[styles.button, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-loading={loading ? '' : undefined}
      data-icon-only={!children && (icon || iconEnd) ? '' : undefined}
      isDisabled={isDisabled || loading}
      aria-describedby={reason ? reasonId : undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.srOnly}>Loading</span>
        </>
      ) : icon ? (
        <span className={styles.icon}>{icon}</span>
      ) : null}
      {children ? <span className={styles.label}>{children}</span> : null}
      {iconEnd ? <span className={styles.icon}>{iconEnd}</span> : null}
    </AriaButton>
  );
  if (!disabledReason) return button;
  // A disabled button gets no hover or focus events, so a wrapper carries the reason (shown on hover). The wrapper stays
  // while the button is enabled too, so the button keeps its DOM node (and focus) when it locks or unlocks.
  return (
    <span
      className={styles.reasonWrap}
      data-reason={reason ?? undefined}
      data-disabled-reason={reason ? '' : undefined}
    >
      {button}
      {reason ? (
        <span id={reasonId} className={styles.srOnly}>
          {reason}
        </span>
      ) : null}
    </span>
  );
});
