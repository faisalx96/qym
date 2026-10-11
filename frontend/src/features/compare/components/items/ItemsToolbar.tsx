/** Search, Filters (badge), Display, CSV and the active-filter chips (with Clear). */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Popover, SearchField, SegmentedControl, Select, Switch, Tag, Text } from '@/ui';
import { setTextMode, type TextMode } from '@/lib/text';
import { useCompare } from '../../CompareContext';
import { activeChips, clearedView } from '../../lib/activeChips';
import { activeFilterCount, SORT_VALUES, type SortBy } from '../../lib/filters';
import { useItemsUi } from './ItemsUi';
import { FilterBuilder } from './FilterBuilder';
import { CsvDialog } from './CsvDialog';
import styles from './ItemsToolbar.module.css';

const SORT_LABEL: Record<SortBy, string> = {
  index: 'Item order',
  score_asc: 'Score, low to high',
  score_desc: 'Score, high to low',
  latency_asc: 'Latency, fast to slow',
  latency_desc: 'Latency, slow to fast',
};

export function ItemsToolbar({ metaKeys }: { metaKeys: string[] }) {
  const { textMode, setTextMode: onTextMode, hiddenFields: hidden, setFieldHidden: onHidden } = useItemsUi();
  const { model, items, defs, c, columns, searchPending } = useCompare();
  const [q, setQ] = useState(c.view.q);
  const [panel, setPanel] = useState(() => c.view.filters.rules.children.length > 0);
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
  const label = (key: string) => columns.find((col) => col.key === key)?.label ?? key;
  const chips = activeChips(c.view, model, label);
  return (
    <div className={styles.toolbar}>
      <div className={styles.row}>
        <SearchField label="Search items" hideLabel placeholder="Search id, input, outputs…" value={q} onChange={setQ} onClear={() => setQ('')} width="min(22rem, 100%)" />
        <Button size="sm" variant="neutral" icon={<Icon name="list" size={14} />} aria-expanded={panel} onPress={() => setPanel((p) => !p)}>
          Filters {count ? <Tag kind="count">{count}</Tag> : null}
        </Button>
        <Popover
          label="Display options"
          trigger={
            <Button size="sm" variant="neutral" icon={<Icon name="settings" size={14} />}>
              Display
            </Button>
          }
        >
          <div className={styles.display}>
            <Select label="Sort" value={c.view.sort} onChange={(k) => k && c.setView({ sort: String(k) as SortBy })} items={(['index', ...SORT_VALUES] as SortBy[]).map((s) => ({ key: s, label: SORT_LABEL[s] }))} />
            <SegmentedControl<TextMode>
              label="Text mode"
              value={textMode}
              onChange={(m) => {
                setTextMode(m);
                onTextMode(m);
              }}
              options={[{ value: 'raw', label: 'Raw' }, { value: 'rendered', label: 'Rendered' }]}
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
        <Button size="sm" variant="neutral" icon={<Icon name="external" size={14} />} onPress={() => setCsv(true)} isDisabled={!items.length}>
          CSV
        </Button>
        <Text variant="sm" tone="muted" className={styles.count} role="status">
          {items.length} of {model.itemIds.length} items{searchPending ? ' · searching…' : ''}
        </Text>
        {count || c.view.q ? (
          <Button size="sm" variant="ghost" onPress={() => c.setView(clearedView())}>
            Clear {count + (c.view.q ? 1 : 0)}
          </Button>
        ) : null}
      </div>
      {chips.length ? (
        <div className={styles.chips} role="group" aria-label="Filters set on the page">
          {chips.map((chip) => (
            <Chip key={chip.key} isSelected onChange={() => c.setView(chip.clear(c.view))} removeLabel={`Remove filter: ${chip.label}`} onRemove={() => c.setView(chip.clear(c.view))}>
              {chip.label.length > 60 ? `${chip.label.slice(0, 60)}…` : chip.label}
            </Chip>
          ))}
        </div>
      ) : null}
      {panel ? <FilterBuilder /> : null}
      {csv ? <CsvDialog open onOpenChange={setCsv} /> : null}
    </div>
  );
}
