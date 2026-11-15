import type { ReactNode } from 'react';
import {
  Header,
  Menu,
  MenuItem,
  MenuSection,
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
  /** The text for typeahead and the accessible name when `label` is not a string. */
  textValue?: string;
  /** cv5 N: items with the same group sit under one quiet group label (consecutive items only). */
  group?: string;
  /** cv5 N: a two-level list (a section and its parts): 0 = a section (600), 1 = a part, indented under it. */
  level?: 0 | 1;
  /** cv5 N: quiet text at the row end (a state such as "not sent"). */
  end?: ReactNode;
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
  /**
   * cv5 N: a menu that also shows where the person is (a jump-to menu): the item with this id is checked (the accent
   * check at its row end, `aria-checked`). An action still runs `onAction`.
   */
  selectedId?: string | null;
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
  selectedId,
}: DropdownMenuProps) {
  const checks = selectedId !== undefined;
  const groups: { name: string | undefined; items: MenuItemSpec[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  const grouped = items.some((i) => i.group);
  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      <AriaPopover placement={placement} offset={6} className={styles.popover}>
        {header ? <div className={styles.header}>{header}</div> : null}
        <Menu
          aria-label={label}
          className={styles.menu}
          data-grouped={grouped ? '' : undefined}
          onAction={(key: Key) => onAction(String(key))}
          disabledKeys={items.filter((i) => i.disabled).map((i) => i.id)}
          selectionMode={checks ? 'single' : undefined}
          selectedKeys={checks ? (selectedId != null ? [selectedId] : []) : undefined}
        >
          {grouped
            ? groups.map((g, n) => (
                <MenuSection key={`${g.name ?? ''}-${n}`} className={styles.section}>
                  {g.name ? <Header className={styles.groupLabel}>{g.name}</Header> : null}
                  {g.items.map((item) => (
                    <MenuItemWithSeparator key={item.id} item={item} />
                  ))}
                </MenuSection>
              ))
            : items.map((item) => <MenuItemWithSeparator key={item.id} item={item} />)}
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
        data-level={item.level !== undefined ? String(item.level) : undefined}
        textValue={item.textValue ?? (typeof item.label === 'string' ? item.label : item.id)}
      >
        {({ isSelected, selectionMode }) => (
          <>
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
            {item.end != null ? <span className={styles.end}>{item.end}</span> : null}
            {item.target === '_blank' ? <Icon name="external" size={12} /> : null}
            {selectionMode !== 'none' ? (
              <span className={styles.check} aria-hidden="true">
                {isSelected ? <Icon name="check" size={12} /> : null}
              </span>
            ) : null}
          </>
        )}
      </MenuItem>
    </>
  );
}
