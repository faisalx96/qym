/** Search, Filters (badge), Display, CSV and the active-filter chips (with Clear). */
import { useEffect, useState } from 'react';
import { Button, Icon, Popover, SearchField, SegmentedControl, Select, Switch, Tag, Text } from '@/ui';
import { setTextMode, type TextMode } from '@/lib/text';
import { useCompare } from '../../CompareContext';
import { clearedView } from '../../lib/activeChips';
import { activeFilterCount, SORT_VALUES, type SortBy } from '../../lib/filters';
import { useItemsUi } from './ItemsUi';
import { CsvDialog } from './CsvDialog';
import styles from './ItemsToolbar.module.css';

const SORT_LABEL: Record<SortBy, string> = {
  index: 'Item order',
  score_asc: 'Score, low to high',
  score_desc: 'Score, high to low',
  latency_asc: 'Latency, fast to slow',
  latency_desc: 'Latency, slow to fast',
  change_desc: 'Biggest change vs baseline',
};

export function ItemsToolbar({
  metaKeys,
  panelOpen,
  onPanelOpen,
  facetsOpen,
  onFacetsOpen,
}: {
  metaKeys: string[];
  panelOpen: boolean;
  onPanelOpen: (open: boolean) => void;
  facetsOpen: boolean;
  onFacetsOpen: (open: boolean) => void;
}) {
  const { textMode, setTextMode: onTextMode, hiddenFields: hidden, setFieldHidden: onHidden } = useItemsUi();
  const { model, items, defs, c, metric, searchPending } = useCompare();
  const [q, setQ] = useState(c.view.q);
  const [csv, setCsv] = useState(false);
  // The URL changed from outside (Clear, back/forward): follow it.
  const [seen, setSeen] = useState(c.view.q);
  if (c.view.q !== seen) {
    setSeen(c.view.q);
    setQ(c.view.q);
  }
  useEffect(() => {
    if (q === c.view.q) return;
    const t = setTimeout(() => c.setView({ q }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const count = activeFilterCount(c.view, defs);
  const clearCount = count + (c.view.q ? 1 : 0);
  return (
    <div className={styles.toolbar} data-part="items-toolbar" data-testid="items-toolbar">
      <div className={styles.query}>
        <SearchField
          label="Search items"
          hideLabel
          placeholder="Search inputs / outputs / expected…"
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          width="100%"
          className={styles.search}
        />
        <Button
          size="sm"
          variant="neutral"
          icon={<Icon name="list" size={14} />}
          iconEnd={<Icon name="chevron-down" size={14} />}
          aria-expanded={panelOpen}
          data-part="items-filters-btn"
          onPress={() => onPanelOpen(!panelOpen)}
        >
          Filters <Tag kind="count">{count}</Tag>
        </Button>
        <Button
          size="sm"
          variant="neutral"
          icon={<Icon name="sidebar" size={14} />}
          aria-expanded={facetsOpen}
          data-part="items-facets-btn"
          onPress={() => onFacetsOpen(!facetsOpen)}
        >
          Quick filters
        </Button>
        {clearCount ? (
          <Button
            size="sm"
            variant="danger"
            icon={<Icon name="close" size={12} />}
            data-part="items-clear-btn"
            onPress={() => c.setView(clearedView())}
          >
            Clear <Tag kind="count">{clearCount}</Tag>
          </Button>
        ) : null}
      </div>
      <div className={styles.actions}>
        <Text variant="sm" tone="muted" className={styles.count} role="status" data-part="items-count">
          {items.length} of {model.itemIds.length} items{searchPending ? ' · searching…' : ''}
        </Text>
        <Popover
          label="Display options"
          trigger={
            <Button
              size="sm"
              variant="neutral"
              icon={<Icon name="menu" size={14} />}
              iconEnd={<Icon name="chevron-down" size={14} />}
              data-part="items-display-btn"
            >
              Display · {metric}
            </Button>
          }
        >
          <div className={styles.display} data-part="display-popover">
            {model.metrics.length > 1 ? (
              <Select
                label="Analysis metric"
                value={metric}
                onChange={(k) =>
                  k && c.setView({ metric: String(k), filters: { ...c.view.filters, baseline: null } })
                }
                items={model.metrics.map((m) => ({ key: m, label: m }))}
              />
            ) : null}
            <Select
              label="Sort"
              value={c.view.sort}
              onChange={(k) => k && c.setView({ sort: String(k) as SortBy })}
              items={(['index', ...SORT_VALUES] as SortBy[]).map((s) => ({ key: s, label: SORT_LABEL[s] }))}
            />
            <SegmentedControl<TextMode>
              label="Text mode"
              value={textMode}
              onChange={(m) => {
                setTextMode(m);
                onTextMode(m);
              }}
              options={[
                { value: 'raw', label: 'Raw' },
                { value: 'rendered', label: 'Rendered' },
              ]}
            />
            {metaKeys.length ? (
              <fieldset className={styles.fields}>
                <legend>
                  <Text variant="sm" tone="muted">
                    Metadata shown on items
                  </Text>
                </legend>
                {metaKeys.map((k) => (
                  <Switch key={k} isSelected={!hidden.has(k)} onChange={(on) => onHidden(k, !on)}>
                    {k}
                  </Switch>
                ))}
              </fieldset>
            ) : null}
          </div>
        </Popover>
        <Button
          size="sm"
          variant="accent"
          icon={<Icon name="download" size={14} />}
          data-part="items-csv-btn"
          onPress={() => setCsv(true)}
          isDisabled={!items.length}
        >
          CSV
        </Button>
      </div>
      {csv ? <CsvDialog open onOpenChange={setCsv} /> : null}
    </div>
  );
}
