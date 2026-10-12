import { forwardRef, type ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { Icon, type IconName } from '../Icon';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  AriaButtonProps,
  'className' | 'style' | 'children' | 'aria-label'
> {
  /** Required accessible name; also the title. */
  label: string;
  icon: IconName | ReactNode;
  tone?: 'default' | 'danger' | 'approve' | 'reject';
  /** Shows the "copied" green glyph state. */
  active?: boolean;
  className?: string;
}

/** .qym-icon-action: 24px glyph-only action; hover changes only the glyph colour. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', active, className, ...rest },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      aria-label={label}
      className={[styles.iconAction, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-active={active ? '' : undefined}
      {...rest}
    >
      {typeof icon === 'string' ? <Icon name={icon as IconName} size={14} /> : icon}
    </AriaButton>
  );
});
