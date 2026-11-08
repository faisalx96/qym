import { Button } from '../Button';
import { Chip } from '../Chip';
import { Icon } from '../Icon';
import { Tag } from '../Tag';
import { Text } from '../Text';
import styles from './ScopeBar.module.css';

export interface ScopeChip {
  key: string;
  label: string;
  onClear: () => void;
}

/**
 * The filter chips of a scope (ScopeBar and the sidebar's Active group share them). `removable={false}` (the run
 * ScopeBar, C-44) draws the chips with no × and a click does nothing: the one Clear is in the sticky section nav.
 */
export function ScopeChips({
  chips,
  maxChips = 6,
  removable = true,
}: {
  chips: ScopeChip[];
  maxChips?: number;
  removable?: boolean;
}) {
  const visible = chips.slice(0, maxChips);
  const more = chips.length - visible.length;
  return (
    <>
      {visible.map((chip) => (
        <Chip
          key={chip.key}
          isSelected
          {...(removable
            ? {
                removeLabel: `Remove ${chip.label} from scope`,
                onRemove: chip.onClear,
                onChange: chip.onClear,
              }
            : {})}
        >
          {chip.label.length > 56 ? `${chip.label.slice(0, 55)}…` : chip.label}
        </Chip>
      ))}
      {more > 0 ? <Tag kind="count">+{more}</Tag> : null}
    </>
  );
}

export interface ScopeBarProps {
  shown: number;
  total: number;
  chips: ScopeChip[];
  /** cv3-shim: remove after C-44 (deprecated: the ScopeBar has no Clear all; this prop does nothing). */
  onClearAll?: () => void;
  onJumpToItems: () => void;
  /** Wide: the inline sidebar is shown. Narrow: the drawer is open. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Narrow viewports open a drawer ("Quick filters") instead of hiding an inline column. */
  narrow?: boolean;
  /** Chips beyond this are folded into "+N". */
  maxChips?: number;
  noun?: string;
  /** The sidebar beside the report already lists the chips (Active group). */
  hideChips?: boolean;
}

/** The scope strip above the report: "N of M items", the filters (no ×, no Clear: C-44) and the sidebar toggle. */
export function ScopeBar({
  shown,
  total,
  chips,
  onJumpToItems,
  sidebarOpen,
  onToggleSidebar,
  narrow = false,
  maxChips = 6,
  noun = 'items',
  hideChips = false,
}: ScopeBarProps) {
  return (
    <div className={styles.bar} role="region" aria-label="Scope of this report" data-testid="scope-bar">
      <Text variant="base" tone="primary" weight={650} className={styles.count}>
        Scope: {shown.toLocaleString('en-US')} of {total.toLocaleString('en-US')} {noun}
      </Text>
      {hideChips ? null : (
        <div className={styles.chips}>
          <ScopeChips chips={chips} maxChips={maxChips} removable={false} />
        </div>
      )}
      <div className={styles.actions}>
        <Button size="sm" variant="neutral" onPress={onJumpToItems}>
          View {shown.toLocaleString('en-US')} {noun}
        </Button>
        <Button
          size="sm"
          variant="neutral"
          icon={<Icon name="sidebar" size={12} />}
          aria-expanded={sidebarOpen}
          onPress={onToggleSidebar}
          data-testid="scope-toggle"
        >
          {narrow ? 'Quick filters' : sidebarOpen ? 'Hide filters' : 'Show filters'}
        </Button>
      </div>
    </div>
  );
}
