/** The item-by-item section: baseline-delta banner, one-row toolbar, inline filter panel, run key, the card list. */
import { useMemo, useState } from 'react';
import { Button, EmptyState, Icon, Popover, ReportLayout } from '@/ui';
import { useMediaQuery } from '@/features/shell';
import { HIDDEN_METADATA_KEYS } from '@/features/run-detail/lib/rowMeta';
import { useCompare } from '../../CompareContext';
import { hasAnyRootCause } from '../../lib/breakdown';
import { QuickFilters } from '../QuickFilters';
import { RunTag } from '../RunTag';
import { columnName } from '../../lib/columnName';
import { AnalyzeLinks } from '../panel/RootCauseTab';
import { scrollToSection } from '../sectionIds';
import { FilterBuilder } from './FilterBuilder';
import { ItemList } from './ItemList';
import { ItemsBanner } from './ItemsBanner';
import { ItemsToolbar } from './ItemsToolbar';
import styles from './ItemsSection.module.css';

const WIDE_QUERY = '(min-width: 1200px)';

/** The run key above the list: colour (and letter) -> name, once; the rows carry colour only (C-row-5). */
function RunKey() {
  const { model, columns, baseline } = useCompare();
  return (
    <ul className={styles.runKey} data-part="run-key" aria-label="Run colours">
      {columns.map((col) => (
        <li key={col.key}>
          <RunTag
            index={col.runIdxs[0] ?? 0}
            name={columnName(model, col)}
            title={col.title}
            baseline={col.key === baseline.key}
          />
        </li>
      ))}
    </ul>
  );
}

export function ItemsSection() {
  const { model } = useCompare();
  const metaKeys = useMemo(
    () => model.metadataKeys.filter((k) => !HIDDEN_METADATA_KEYS.has(k)),
    [model.metadataKeys],
  );
  const { items, c } = useCompare();
  const wide = useMediaQuery(WIDE_QUERY);
  // The facet list is opened from the toolbar and never on its own (owner decision H2).
  const [facets, setFacets] = useState(false);
  const [panel, setPanel] = useState(() => c.view.filters.rules.children.length > 0);
  if (model.alignment.status !== 'aligned')
    return (
      <EmptyState
        compact
        title="Item-level comparison is unavailable"
        body="These runs cannot be aligned item by item; the run-level analytics still work."
      />
    );
  return (
    <div className={styles.section}>
      <ItemsBanner />
      <ItemsToolbar
        metaKeys={metaKeys}
        panelOpen={panel}
        onPanelOpen={setPanel}
        facetsOpen={facets}
        onFacetsOpen={setFacets}
      />
      {panel ? (
        <FilterBuilder
          onClose={() => {
            setPanel(false);
            document.querySelector<HTMLElement>('[data-part=items-filters-btn]')?.focus();
          }}
        />
      ) : null}
      <ReportLayout
        wide={wide}
        sidebarOpen={facets}
        drawerOpen={facets}
        onDrawerOpenChange={setFacets}
        sidebar={
          <QuickFilters
            onHide={wide ? () => setFacets(false) : undefined}
            onViewItems={() => {
              setFacets(false);
              scrollToSection('items');
            }}
          />
        }
        className={styles.layout}
      >
        <div className={styles.listCol}>
          <RunKey />
          {items.length ? (
            <ItemList />
          ) : (
            <EmptyState compact title="No items match" body="Clear a filter or the search to see more items." />
          )}
        </div>
      </ReportLayout>
    </div>
  );
}

/** Auto-analyze: only when an analysis exists on the compared runs (C-items-1). */
export function ItemsHeadAside() {
  const { model } = useCompare();
  const any = useMemo(() => hasAnyRootCause(model, new Set(model.itemIds)), [model]);
  if (!any) return null;
  return (
    <Popover
      label="Auto-analyze runs"
      trigger={
        <Button size="sm" variant="neutral" icon={<Icon name="search" size={14} />}>
          Auto-analyze
        </Button>
      }
    >
      <AnalyzeLinks />
    </Popover>
  );
}
