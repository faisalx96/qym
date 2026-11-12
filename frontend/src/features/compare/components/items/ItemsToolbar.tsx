/** Search, Quick filters, the item count, Sort, Display and CSV (K6: Metric, Filters and Clear live in the sticky nav). */
import { useEffect, useState } from 'react';
import { Button, Icon, Popover, SearchField, SegmentedControl, Select, Switch, Text } from '@/ui';
import { setTextMode, type TextMode } from '@/lib/text';
import { useCompare } from '../../CompareContext';
import { SORT_VALUES, type SortBy } from '../../lib/filters';
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

/** Search, Quick filters, the count, Sort, Display and CSV. Metric, Filters and Clear are in the sticky nav (K6, C154). */
export function ItemsToolbar({
  metaKeys,
  facetsOpen,
  onFacetsOpen,
}: {
  metaKeys: string[];
  facetsOpen: boolean;
  onFacetsOpen: (open: boolean) => void;
}) {
  const { textMode, setTextMode: onTextMode, hiddenFields: hidden, setFieldHidden: onHidden } = useItemsUi();
  const { model, items, c, searchPending } = useCompare();
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
  return (
    <div className={styles.toolbar} data-part="items-toolbar" data-testid="items-toolbar">
      <div className={styles.query}>
        <SearchField
          label="Search items"
          hideLabel
          placeholder="Search inputs / outputs / expected"
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          width="var(--search-width)"
          className={styles.search}
        />
        <Button
          size="sm"
          variant="neutral"
          icon={<Icon name="sidebar" size={12} />}
          aria-expanded={facetsOpen}
          data-part="items-facets-btn"
          onPress={() => onFacetsOpen(!facetsOpen)}
        >
          Quick filters
        </Button>
      </div>
      <div className={styles.actions}>
        <Text variant="sm" tone="muted" className={styles.count} role="status" data-part="items-count">
          {items.length} of {model.itemIds.length} items{searchPending ? ' · searching…' : ''}
        </Text>
        {/* K3 (C029): one Sort, in the toolbar; it lists 'Biggest change vs baseline' */}
        <Select
          label="Sort"
          hideLabel
          value={c.view.sort}
          onChange={(k) => k && c.setView({ sort: String(k) as SortBy })}
          items={(['index', ...SORT_VALUES] as SortBy[]).map((s) => ({ key: s, label: SORT_LABEL[s] }))}
          width="15rem"
        />
        <Popover
          label="Display options"
          trigger={
            <Button
              size="sm"
              variant="neutral"
              icon={<Icon name="menu" size={12} />}
              iconEnd={<Icon name="chevron-down" size={12} />}
              data-part="items-display-btn"
            >
              Display
            </Button>
          }
        >
          <div className={styles.display} data-part="display-popover">
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
          icon={<Icon name="download" size={12} />}
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
