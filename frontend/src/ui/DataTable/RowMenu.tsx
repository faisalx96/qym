import { useEffect, useRef } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { DropdownMenu, type MenuItemSpec } from '../DropdownMenu';
import { Icon } from '../Icon';
import { useRowArmed } from './useRowArmed';
import styles from './DataTable.module.css';

/**
 * One row's actions behind a single handle (owner decision, Nov 1: "all action buttons inside >"): a borderless 20px
 * handle (`chevron-right`, named by `label`) that opens one menu with every row action. Each item can carry its action
 * tile as `icon` (`ActionTile`), so the menu keeps the row's iconography. Put it in a `Column.menuColumn` cell: the
 * handle shows on the hovered or focused row, while its menu is open, and on every row of a touch screen.
 */
export function RowMenu({
  label,
  items,
  onAction,
}: {
  label: string;
  items: MenuItemSpec[];
  onAction: (id: string) => void;
}) {
  // Lean rows (C020): a plain button with the handle's look until the row is hovered or focused, then the menu.
  const { armed, ref, arm } = useRowArmed<HTMLSpanElement>({ skipSelf: true });
  const trigger = useRef<HTMLButtonElement>(null);
  // a press on the plain handle mounts the menu trigger and passes the press on to it
  const pending = useRef(false);
  useEffect(() => {
    if (armed && pending.current) {
      pending.current = false;
      trigger.current?.focus();
      trigger.current?.click();
    }
  }, [armed]);
  if (!items.length) return null;
  return (
    <span className={styles.rowMenu} ref={ref}>
      {armed ? (
        <DropdownMenu
          label={label}
          placement="bottom end"
          items={items}
          onAction={onAction}
          trigger={
            <AriaButton ref={trigger} className={styles.rowMenuHandle} aria-label={label} data-row-menu="">
              <Icon name="chevron-right" size={12} />
            </AriaButton>
          }
        />
      ) : (
        <button
          type="button"
          className={styles.rowMenuHandle}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={false}
          data-row-menu=""
          onClick={() => {
            pending.current = true;
            arm();
          }}
        >
          <Icon name="chevron-right" size={12} />
        </button>
      )}
    </span>
  );
}
