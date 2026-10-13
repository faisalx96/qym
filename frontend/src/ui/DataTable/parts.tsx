import type { ReactNode } from 'react';
import { Button } from '../Button';
import { DropdownMenu } from '../DropdownMenu';
import { Icon } from '../Icon';
import { Pagination, type PaginationProps } from '../Pagination';
import { ColumnsMenu } from './ColumnsMenu';
import { useDataTableCtx } from './context';
import type { Density } from './types';
import styles from './DataTable.module.css';

export interface ToolbarProps {
  /** Search field (SearchField). */
  search?: ReactNode;
  /** Filters trigger (Popover) and similar controls. */
  filters?: ReactNode;
  /** Active filter chip strip. */
  chips?: ReactNode;
  /** "43 runs" style count. */
  count?: ReactNode;
  /** Extra controls on the right (Select, Export …). */
  trailing?: ReactNode;
  /** Columns menu: default shown when the table has 5+ hideable columns. */
  columnsMenu?: boolean;
  /** Density menu: default shown unless the table locks its density. */
  densityMenu?: boolean;
}

const DENSITIES: { id: Density; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'regular', label: 'Regular' },
  { id: 'comfortable', label: 'Comfortable' },
];

/** Search, filters, chips, count, then the built-in Columns and Density menus. */
export function Toolbar({ search, filters, chips, count, trailing, columnsMenu, densityMenu }: ToolbarProps) {
  const { model, columns, selectedCount, bulkActions, bulkOwnSummary, clearSelection } = useDataTableCtx();
  const selecting = selectedCount > 0 && Boolean(bulkActions);
  const hideable = columns.filter((c) => c.hideable !== false && !c.id.startsWith('__'));
  const showColumns = columnsMenu ?? hideable.length >= 5;
  const showDensity = densityMenu ?? !model.densityLocked;
  return (
    <div className={styles.toolbar} data-dt-toolbar="">
      {selecting ? (
        <div
          className={styles.selectionCluster}
          role="group"
          aria-label="Selection actions"
          data-selection-bar=""
        >
          {bulkOwnSummary ? null : (
            <span className={styles.selCount} role="status">
              {selectedCount} selected
            </span>
          )}
          {bulkActions}
          {bulkOwnSummary ? null : (
            <Button variant="ghost" onPress={clearSelection}>
              Clear selection
            </Button>
          )}
        </div>
      ) : null}
      <div className={styles.toolbarMain}>
        {search}
        {filters}
        {chips ? <div className={styles.chips}>{chips}</div> : null}
      </div>
      <div className={styles.toolbarEnd}>
        {count ? <span className={styles.count}>{count}</span> : null}
        {trailing}
        {showColumns ? <ColumnsMenu columns={columns} model={model} /> : null}
        {showDensity ? (
          <DropdownMenu
            label="Row density"
            trigger={
              <Button icon={<Icon name="menu" size={12} />} aria-label="Row density">
                Density
              </Button>
            }
            items={DENSITIES.map((d) => ({
              id: d.id,
              label: d.label,
              icon: model.density === d.id ? <Icon name="check" size={12} /> : <span style={{ width: 12 }} />,
            }))}
            onAction={(id) => model.setDensity(id as Density)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function SelectionBar() {
  const { selectedCount, clearSelection, bulkActions } = useDataTableCtx();
  if (selectedCount === 0 || !bulkActions) return null;
  return (
    <div className={styles.toolbar} data-selection-bar="" role="region" aria-label="Selection actions">
      <div className={styles.toolbarMain}>
        <span className={styles.selCount} role="status">
          {selectedCount} selected
        </span>
        {bulkActions}
      </div>
      <div className={styles.toolbarEnd}>
        <Button variant="ghost" onPress={clearSelection}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}

export interface FooterProps {
  /** Test id / accessible name of the footer landmark. */
  testId?: string;
  ariaLabel?: string;
  /** "1-50 of 423 runs". */
  summary?: ReactNode;
  pagination?: PaginationProps;
  /** "Last updated 16:30:12" and similar. */
  trailing?: ReactNode;
}

export function Footer({ summary, pagination, trailing, testId, ariaLabel }: FooterProps) {
  const { selectedCount } = useDataTableCtx();
  return (
    <footer className={styles.footer} data-dt-footer="" data-testid={testId} aria-label={ariaLabel}>
      <div className={styles.footerStart}>
        {summary ? <span className={styles.count}>{summary}</span> : null}
        {selectedCount > 0 ? <span className={styles.count}>{selectedCount} selected</span> : null}
      </div>
      {pagination ? <Pagination showSummary={!summary} {...pagination} /> : <span />}
      <div className={styles.footerEnd}>{trailing}</div>
    </footer>
  );
}
