import type { ReactNode } from 'react';
import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  Separator,
  type Key,
  type PopoverProps,
} from 'react-aria-components';
import { Icon } from '../Icon';
import buttonStyles from '../Button/Button.module.css';
import '../Button/reasonPlacement';
import styles from './DropdownMenu.module.css';

export interface MenuItemSpec {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** danger: red (delete, reject); meta: purple (auto-analysis, owner decision Nov 1). */
  tone?: 'danger' | 'meta';
  disabled?: boolean;
  /** Why the item is locked; shown in the reason box of the disabled-control recipe (A-22). */
  disabledReason?: string;
  /** Renders as a link (full navigation). */
  href?: string;
  /** '_blank' opens a new tab; only then the item shows the 'external' Icon. */
  target?: '_blank';
  separatorBefore?: boolean;
  description?: string;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: MenuItemSpec[];
  onAction: (id: string) => void;
  label: string;
  placement?: PopoverProps['placement'];
  /** Header rendered above the items (user card, etc.). */
  header?: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Action menu: arrow keys, typeahead, Escape, focus return (React Aria Menu). */
export function DropdownMenu({
  trigger,
  items,
  onAction,
  label,
  placement = 'bottom end',
  header,
  isOpen,
  onOpenChange,
}: DropdownMenuProps) {
  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      <AriaPopover placement={placement} offset={6} className={styles.popover}>
        {header ? <div className={styles.header}>{header}</div> : null}
        <Menu
          aria-label={label}
          className={styles.menu}
          onAction={(key: Key) => onAction(String(key))}
          disabledKeys={items.filter((i) => i.disabled).map((i) => i.id)}
        >
          {items.map((item) => (
            <MenuItemWithSeparator key={item.id} item={item} />
          ))}
        </Menu>
      </AriaPopover>
    </MenuTrigger>
  );
}

function MenuItemWithSeparator({ item }: { item: MenuItemSpec }) {
  const reason = item.disabled && item.disabledReason ? item.disabledReason : null;
  // A locked item with a reason shows it on hover (the Button recipe); the reason is part of the item's text.
  const text = (
    <span className={styles.text}>
      {item.label}
      {item.description ? <span className={styles.description}>{item.description}</span> : null}
      {reason ? <span className={buttonStyles.srOnly}>{reason}</span> : null}
    </span>
  );
  return (
    <>
      {item.separatorBefore ? <Separator className={styles.separator} /> : null}
      <MenuItem
        id={item.id}
        href={item.href}
        target={item.target}
        className={styles.item}
        data-tone={item.tone}
        textValue={typeof item.label === 'string' ? item.label : item.id}
      >
        {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
        {reason ? (
          <span
            className={[buttonStyles.reasonWrap, styles.reasonItem].join(' ')}
            data-reason={reason}
            data-disabled-reason=""
            data-reason-beside=""
          >
            {text}
          </span>
        ) : (
          text
        )}
        {item.target === '_blank' ? <Icon name="external" size={12} /> : null}
      </MenuItem>
    </>
  );
}
