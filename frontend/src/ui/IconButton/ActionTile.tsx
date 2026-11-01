import { Icon, type IconName } from '../Icon';
import styles from './IconButton.module.css';

/**
 * A row action tile drawn alone (no button): the same 20px square, soft tint and 12px glyph as `IconButton tile`,
 * for a menu item that carries its action's tile (the runs-list row menu, the run header's Actions menu).
 */
export function ActionTile({ icon, tone = 'default' }: { icon: IconName; tone?: 'default' | 'danger' }) {
  return (
    <span className={styles.iconAction} data-tile="" data-tone={tone} data-static="" aria-hidden="true">
      <Icon name={icon} size={12} />
    </span>
  );
}
