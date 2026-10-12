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
import styles from './DropdownMenu.module.css';

export interface MenuItemSpec {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  tone?: 'danger';
  disabled?: boolean;
  /** Renders as a link (full navigation). */
  href?: string;
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
  return (
    <>
      {item.separatorBefore ? <Separator className={styles.separator} /> : null}
      <MenuItem
        id={item.id}
        href={item.href}
        className={styles.item}
        data-tone={item.tone}
        textValue={typeof item.label === 'string' ? item.label : item.id}
      >
        {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
        <span className={styles.text}>
          {item.label}
          {item.description ? <span className={styles.description}>{item.description}</span> : null}
        </span>
        {item.href ? <Icon name="external" size={12} /> : null}
      </MenuItem>
    </>
  );
}
