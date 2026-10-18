/** The Items section: header, filter bar, filter banner, virtualized table or heatmap, deep link to ?item=. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTextMode, type TextMode } from '@/lib/text';
import { useInView } from '@/lib/useInView';
import { Button, HelpMarker, Icon, LinkButton, SectionHeader } from '@/ui';
import { useItemDetails } from '../hooks/useItemDetails';
import { REASON_ORDER } from '../lib/itemReasons';
import { emptyFilters, type SortBy } from '../lib/filterRules';
import { useRunPage } from '../RunContext';
import { CsvExport } from './items/CsvExport';
import { FilterBar } from './items/FilterBar';
import { Heatmap } from './items/Heatmap';
import { defaultPageSize } from '../lib/itemsPaging';
import { ItemsTable, PAGE_SIZES } from './items/ItemsTable';
import { ItemsUi, type ItemsUiValue } from './items/ItemsUi';
import styles from './ItemsSection.module.css';

const HIGHLIGHT_MS = 2600;
void PAGE_SIZES;

export function ItemsSection() {
  const { runId, model, api, items, payload, basePath, readOnly, needGroup } = useRunPage();
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

  // The item texts (the `text` row group) load when the table is within a viewport of the screen, or a deep link,
  // a search or a rule needs them.
  const near = useInView(sectionRef, { rootMargin: '100% 0px' });
  useEffect(() => {
    if (near || itemParam) needGroup('text');
  }, [near, itemParam, needGroup]);

  const handled = useRef<string | null>(null);
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
      // A click is not a deep link: don't scroll or highlight the row the reader just opened.
      if (willOpen) handled.current = itemId;
      if (willOpen) setItemParam(itemId);
      else if (itemParam === itemId) setItemParam(null);
    },
    [expanded, itemParam, setItemParam],
  );

  // Deep link: ?item=ID opens that item on the right page and scrolls it into view with a highlight.
  useEffect(() => {
    if (!itemParam) {
      handled.current = null;
      return;
    }
    if (handled.current === itemParam) return;
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
    const pageSize = Number(localStorage.getItem('qym:run-page-size')) || defaultPageSize(items.length);
    const page = Math.floor(idx / pageSize) + 1;
    if (page !== view.page) api.setView({ page });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((prev) => new Set(prev).add(itemParam));
    setScrollTarget(itemParam);
    setHighlight(itemParam);
  }, [itemParam, items, model.rows, view, api]);

  // Its own effect: the deep-link effect re-runs on every page/filter change and must not cancel the timer.
  useEffect(() => {
    if (!highlight) return undefined;
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);

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

  const metric = api.selectedMetric;
  const bannerKinds: Record<string, string> = { failed: 'fail', passed: 'pass', metric_errors: 'error on' };
  const showBanner = view.show === 'passed' || view.show === 'failed' || view.show === 'metric_errors';

  return (
    <ItemsUi.Provider value={ui}>
      <section id="run-items" ref={sectionRef} className={styles.section} aria-labelledby="run-items-title">
        <div className={styles.head}>
          <SectionHeader
            id="run-items-title"
            level="xl"
            title="Items"
            description="Every input, outcome and metric. Filters apply to the table and to every section above."
            aside={
              <span className={styles.aside}>
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
              </span>
            }
          />
        </div>
        <div className={styles.sticky} data-run-filters="">
          <FilterBar display={{ textMode, onTextMode: setTextMode }} />
        </div>
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
              // The cell's own pass opens: that item as that pass produced it.
              api.replaceView({ ...view, view: 'cards', page: 1 }, { item: itemId, pass: String(pass) });
              setExpanded((prev) => new Set(prev).add(itemId));
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
