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
  tone?: 'default' | 'danger' | 'approve' | 'reject' | 'meta';
  /** Shows the "copied" green glyph state. */
  active?: boolean;
  /** Row action tile: a 20px square (`--badge-height`, 12px glyph), the tone's soft tint at rest and a stronger tint on
   * hover (the runs Actions column). */
  tile?: boolean;
  className?: string;
}

/** .qym-icon-action: 24px glyph-only action; hover changes only the glyph colour. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', active, tile, className, ...rest },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      aria-label={label}
      className={[styles.iconAction, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-active={active ? '' : undefined}
      data-tile={tile ? '' : undefined}
      {...rest}
    >
      {typeof icon === 'string' ? <Icon name={icon as IconName} size={tile ? 12 : 14} /> : icon}
    </AriaButton>
  );
});

/**
 * The look of a row action tile with no action of its own: the glyph of an item in a row menu (`RowMenu`), so the menu
 * keeps the row's iconography (owner decision, Nov 1). `meta` is the purple of auto-analysis.
 */
export function ActionTile({
  icon,
  tone = 'default',
}: {
  icon: IconName | ReactNode;
  tone?: 'default' | 'danger' | 'meta';
}) {
  return (
    <span className={styles.iconAction} data-tile="" data-tone={tone} data-static="" aria-hidden="true">
      {typeof icon === 'string' ? <Icon name={icon as IconName} size={12} /> : icon}
    </span>
  );
}
