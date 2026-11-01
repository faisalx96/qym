import { Button as AriaButton } from 'react-aria-components';
import { DropdownMenu, type MenuItemSpec } from '../DropdownMenu';
import { Icon } from '../Icon';
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
  if (!items.length) return null;
  return (
    <span className={styles.rowMenu}>
      <DropdownMenu
        label={label}
        placement="bottom end"
        items={items}
        onAction={onAction}
        trigger={
          <AriaButton className={styles.rowMenuHandle} aria-label={label} data-row-menu="">
            <Icon name="chevron-right" size={12} />
          </AriaButton>
        }
      />
    </span>
  );
}
