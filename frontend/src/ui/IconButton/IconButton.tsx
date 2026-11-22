import { forwardRef, useId, type ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import buttonStyles from '../Button/Button.module.css';
import '../Button/reasonPlacement';
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
  /** Row action tile: a 22px square (`--tile-size`, 13px glyph, cv5 H2), the tone's tile tint at rest and a stronger tint on
   * hover (the runs Actions column). */
  tile?: boolean;
  /** Why the button is locked: shown on hover and read with the button (A-22, the Button recipe). */
  disabledReason?: string;
  /**
   * The X that closes a surface (a drawer, side pane, dialog, panel, toast): muted at rest, the error red on hover and
   * press (G3, owner: "close button X glows green on hover? should be red"). On by itself for the `close` glyph in the
   * default tone; an X that removes a value (a chip, a mapping, a list entry) passes `closes={false}` and keeps the
   * accent hover.
   */
  closes?: boolean;
  className?: string;
}

/** .qym-icon-action: 24px glyph-only action; hover changes only the glyph colour. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', active, tile, disabledReason, closes, className, isDisabled, ...rest },
  ref,
) {
  const reasonId = useId();
  const isClose = closes ?? (icon === 'close' && tone === 'default' && !tile);
  const reason = isDisabled && disabledReason ? disabledReason : null;
  const button = (
    <AriaButton
      ref={ref}
      aria-label={label}
      aria-describedby={reason ? reasonId : undefined}
      isDisabled={isDisabled}
      className={[styles.iconAction, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-active={active ? '' : undefined}
      data-tile={tile ? '' : undefined}
      data-close={isClose ? '' : undefined}
      {...rest}
    >
      {typeof icon === 'string' ? <Icon name={icon as IconName} size={14} /> : icon}
    </AriaButton>
  );
  if (!reason) return button;
  // A disabled button gets no hover events, so a wrapper carries the reason box (ui/Button recipe).
  return (
    <span className={buttonStyles.reasonWrap} data-reason={reason} data-disabled-reason="">
      {button}
      <span id={reasonId} className={buttonStyles.srOnly}>
        {reason}
      </span>
    </span>
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
