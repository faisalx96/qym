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
  /** Extra controls on the right (Select, Export …). */
  trailing?: ReactNode;
  /** Full-width rows under the main line (filter facets, chips). */
  rows?: ReactNode;
  /** Columns menu: default shown when the table has 5+ hideable columns. */
  columnsMenu?: boolean;
  /** Density menu: default shown unless the table locks its density. */
  densityMenu?: boolean;
  /**
   * While rows are selected, the selection actions take the toolbar's place at the same height, so the table does not
   * move down (C228). The toolbar's own controls stay laid out under them, hidden.
   */
  selectionReplaces?: boolean;
}

const DENSITIES: { id: Density; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'regular', label: 'Regular' },
  { id: 'comfortable', label: 'Comfortable' },
];

/** Search, filters, chips, then the built-in Columns and Density menus. A list toolbar shows no count (D-11). */
export function Toolbar({
  search,
  filters,
  chips,
  rows,
  trailing,
  columnsMenu,
  densityMenu,
  selectionReplaces,
}: ToolbarProps) {
  const {
    model,
    columns,
    reorderable,
    suspended,
    selectedCount,
    bulkActions,
    bulkOwnSummary,
    bulkAlways,
    clearSelection,
  } = useDataTableCtx();
  const selecting = (selectedCount > 0 || bulkAlways) && Boolean(bulkActions);
  const hideable = columns.filter((c) => c.hideable !== false && !c.id.startsWith('__'));
  const showColumns = columnsMenu ?? hideable.length >= 5;
  const showDensity = densityMenu ?? !model.densityLocked;
  const cluster = selecting ? (
    <div
      className={styles.selectionCluster}
      role={bulkOwnSummary ? undefined : 'region'}
      aria-label={bulkOwnSummary ? undefined : 'Selection actions'}
      data-selection-bar=""
    >
      {bulkOwnSummary ? null : (
        <span className={styles.selCount} role="status">
          {selectedCount} selected
        </span>
      )}
      {bulkActions}
      {bulkOwnSummary ? null : (
        <Button variant="neutral" onPress={clearSelection}>
          Clear selection
        </Button>
      )}
    </div>
  ) : null;
  const main = (
    <div className={styles.toolbarMain}>
      {search}
      {filters}
      {chips ? <div className={styles.chips}>{chips}</div> : null}
    </div>
  );
  if (selectionReplaces && cluster)
    return (
      <div className={styles.toolbar} data-dt-toolbar="" data-selection-replaces="">
        <div className={styles.selectionOverlay}>{cluster}</div>
        {/* visibility: hidden also takes these controls out of the Tab order */}
        <div className={styles.toolbarHidden} aria-hidden="true">
          {main}
          <div className={styles.toolbarEnd}>{trailing}</div>
        </div>
      </div>
    );
  return (
    <div className={styles.toolbar} data-dt-toolbar="">
      {rows && cluster ? (
        // With facet rows the selection is a line of its own above them (round 10): its actions never push the search,
        // the filters or the end controls aside, and never wrap the end controls under the filters.
        <div className={styles.selectionLine}>{cluster}</div>
      ) : null}
      {rows ? (
        // Facet rows under the main line: the end controls centre on the whole block, not on its first line.
        <div className={styles.toolbarStart}>
          <div className={styles.toolbarLine}>{main}</div>
          <div className={styles.toolbarRows}>{rows}</div>
        </div>
      ) : (
        <>
          {cluster}
          {main}
        </>
      )}
      <div className={styles.toolbarEnd}>
        {trailing}
        {showColumns ? (
          <ColumnsMenu columns={columns} model={model} reorderable={reorderable} suspended={suspended} />
        ) : null}
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
  const { selectedCount, clearSelection, bulkActions, bulkAlways } = useDataTableCtx();
  if ((selectedCount === 0 && !bulkAlways) || !bulkActions) return null;
  return (
    <div className={styles.toolbar} data-selection-bar="" role="region" aria-label="Selection actions">
      <div className={styles.toolbarMain}>
        <span className={styles.selCount} role="status">
          {selectedCount} selected
        </span>
        {bulkActions}
      </div>
      <div className={styles.toolbarEnd}>
        <Button variant="neutral" onPress={clearSelection}>
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
  /** "Filtered from 423 runs" at the far left, while a search or filter narrows the list (D-10). */
  filterNote?: string;
  pagination?: PaginationProps;
  /** "Last updated 16:30:12" and similar. */
  trailing?: ReactNode;
  /** A control centred in the footer (the 'Show N more' button, docs 3.4). Shown only when there is no pagination. */
  center?: ReactNode;
}

export function Footer({
  filterNote,
  pagination,
  center,
  trailing,
  testId,
  ariaLabel,
}: FooterProps) {
  const { selectedCount } = useDataTableCtx();
  return (
    <footer
      className={styles.footer}
      data-dt-footer=""
      data-testid={testId}
      aria-label={ariaLabel}
      data-center={center && !pagination ? '' : undefined}
    >
      <div className={styles.footerStart}>
        {filterNote ? <span className={styles.filterNote}>{filterNote}</span> : null}
        {selectedCount > 0 ? <span className={styles.count}>{selectedCount} selected</span> : null}
      </div>
      {pagination ? (
        <Pagination {...pagination} />
      ) : center ? (
        <div className={styles.footerCenter}>{center}</div>
      ) : (
        <span />
      )}
      <div className={styles.footerEnd}>{trailing}</div>
    </footer>
  );
}
