/** The Items section: header, filter bar, filter banner, virtualized table or heatmap, deep link to ?item=. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTextMode, type TextMode } from '@/lib/text';
import { Button, HelpMarker, Icon, LinkButton, SectionHeader, StatStrip } from '@/ui';
import { useItemDetails } from '../hooks/useItemDetails';
import { REASON_ORDER } from '../lib/itemReasons';
import { runCounts } from '../lib/overviewModel';
import { emptyFilters, type SortBy } from '../lib/filterRules';
import { useRunPage } from '../RunContext';
import { CsvExport } from './items/CsvExport';
import { FilterBar } from './items/FilterBar';
import { Heatmap } from './items/Heatmap';
import { ItemsTable, PAGE_SIZES } from './items/ItemsTable';
import { ItemsUi, type ItemsUiValue } from './items/ItemsUi';
import styles from './ItemsSection.module.css';

const HIGHLIGHT_MS = 2600;
void PAGE_SIZES;

export function ItemsSection({
  panelOpen,
  onOpenPanel,
  wide,
}: {
  panelOpen: boolean;
  onOpenPanel: () => void;
  wide: boolean;
}) {
  const { runId, model, api, items, payload, basePath, readOnly } = useRunPage();
  const { view } = api;
  const sectionRef = useRef<HTMLElement>(null);
  const details = useItemDetails(runId);
  const [textMode, setTextMode] = useState<TextMode>(() => getTextMode());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const hiddenFields = useMemo(() => new Set(view.hideFields), [view.hideFields]);
  const hiddenMetricFields = useMemo(() => new Set(view.hideMetricFields), [view.hideMetricFields]);
  const { itemParam, setItemParam, setTraceParam } = api;

  const toggleExpanded = useCallback(
    (itemId: string, open?: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        const willOpen = open ?? !next.has(itemId);
        if (willOpen) next.add(itemId);
        else next.delete(itemId);
        return next;
      });
      const willOpen = open ?? !expanded.has(itemId);
      if (willOpen) setItemParam(itemId);
      else if (itemParam === itemId) setItemParam(null);
    },
    [expanded, itemParam, setItemParam],
  );

  // Deep link: ?item=ID opens that item on the right page and scrolls it into view with a highlight.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!itemParam || handled.current === itemParam) return;
    const exists = model.rows.some((r) => r.item_id === itemParam);
    if (!exists) return;
    const idx = items.findIndex((i) => i.row.item_id === itemParam);
    if (idx < 0) {
      // Filtered out: the link wins, so drop the filters once.
      handled.current = itemParam;
      api.replaceView({ ...view, q: '', show: 'all', page: 1, filters: emptyFilters() });
      handled.current = null;
      return;
    }
    handled.current = itemParam;
    const pageSize = Number(localStorage.getItem('qym:run-page-size')) || 20;
    const page = Math.floor(idx / pageSize) + 1;
    if (page !== view.page) api.setView({ page });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((prev) => new Set(prev).add(itemParam));
    setScrollTarget(itemParam);
    setHighlight(itemParam);
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [itemParam, items, model.rows, view, api]);

  const openTrace = useCallback(
    (itemId: string, pass: number | null) => setTraceParam(itemId, pass),
    [setTraceParam],
  );
  const ui = useMemo<ItemsUiValue>(
    () => ({
      textMode,
      hiddenFields,
      hiddenMetricFields,
      details,
      expanded,
      toggleExpanded,
      highlight,
      openTrace,
      scrollTarget,
      requestScroll: setScrollTarget,
      clearScroll: () => setScrollTarget(null),
    }),
    [
      textMode,
      hiddenFields,
      hiddenMetricFields,
      details,
      expanded,
      toggleExpanded,
      highlight,
      openTrace,
      scrollTarget,
    ],
  );

  const counts = useMemo(
    () =>
      runCounts(
        items.map((i) => i.row),
        model.isRepeat && !model.viewPass,
      ),
    [items, model.isRepeat, model.viewPass],
  );
  const metric = api.selectedMetric;
  const bannerKinds: Record<string, string> = { failed: 'fail', passed: 'pass', metric_errors: 'error on' };
  const showBanner = view.show === 'passed' || view.show === 'failed' || view.show === 'metric_errors';

  return (
    <ItemsUi.Provider value={ui}>
      <section id="run-items" ref={sectionRef} className={styles.section} aria-labelledby="run-items-title">
        <div className={styles.head}>
          <SectionHeader
            id="run-items-title"
            title="Items"
            description="Every input, outcome and metric. Filters apply to the table and to the analysis panel."
            aside={
              <span className={styles.aside}>
                <span className={styles.stats}>
                  <StatStrip
                    variant="compact-header"
                    aria-label="Run counts"
                    items={[
                      { key: 'items', label: 'Items', value: counts.total },
                      { key: 'completed', label: 'Completed', value: counts.completed },
                      {
                        key: 'errors',
                        label: 'Errors',
                        value: counts.errors,
                        tone: counts.errors ? 'danger' : undefined,
                      },
                      ...(counts.notReceived
                        ? [
                            {
                              key: 'nr',
                              label: 'Not received',
                              value: counts.notReceived,
                              tone: 'warning' as const,
                            },
                          ]
                        : []),
                    ]}
                  />
                </span>
                {readOnly ? null : (
                  <LinkButton
                    size="sm"
                    variant="neutral"
                    to={`${basePath}/analyzer`}
                    icon={<Icon name="sparkles" size={12} />}
                  >
                    Auto-analyze
                  </LinkButton>
                )}
                <CsvExport />
                {!panelOpen || !wide ? (
                  <Button
                    size="sm"
                    variant="neutral"
                    icon={<Icon name="chart" size={12} />}
                    onPress={onOpenPanel}
                    aria-controls="analysis-panel"
                    aria-expanded={panelOpen && wide}
                  >
                    Analysis
                  </Button>
                ) : null}
              </span>
            }
          />
        </div>
        <FilterBar display={{ textMode, onTextMode: setTextMode }} />
        {showBanner && metric ? (
          <div className={styles.banner} role="status" data-testid="filter-banner">
            Filtered to {items.length.toLocaleString('en-US')} items that {bannerKinds[view.show]} {metric}
            <HelpMarker label="How the reason is chosen">
              The reason shown for a failing item comes from the first source that exists:{' '}
              {REASON_ORDER.map((r) => r.source).join(' → ')}.
            </HelpMarker>
            <Button size="sm" variant="ghost" onPress={() => api.setView({ show: 'all' })}>
              Clear filter
            </Button>
          </div>
        ) : null}
        {view.view === 'heatmap' && model.samples > 1 ? (
          <Heatmap
            items={items}
            onOpen={(itemId, pass) => {
              api.replaceView({ ...view, view: 'cards', page: 1 });
              setExpanded((prev) => new Set(prev).add(itemId));
              setItemParam(itemId);
              void pass;
            }}
          />
        ) : (
          <ItemsTable
            items={items}
            page={view.page}
            onPage={(page) => api.setView({ page })}
            sort={view.sort}
            onSort={(sort: SortBy) => api.setView({ sort })}
            sectionRef={sectionRef}
          />
        )}
        <span className={styles.srOnly} aria-live="polite">
          {payload.snapshot.rows.length ? '' : 'This run has no items yet.'}
        </span>
      </section>
    </ItemsUi.Provider>
  );
}
