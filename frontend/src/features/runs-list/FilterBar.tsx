/**
 * The always-visible runs filter bar (redesign 2): Time and Origin inline next to the search, one trigger per facet
 * with its value written on it, `More filters` for the overflow and versioning keys, a chip line under the bar and a
 * single `Clear n`. Below 600 px the bar is the search plus one `Filters n` button opening the full list in a drawer.
 * URL state is unchanged (`viewToParams` / `parseView`).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Key } from 'react-aria-components';
import type { Facets } from '@/api/dashboardTypes';
import { Button, Chip, Drawer, Icon, MultiSelect, Popover, SearchField } from '@/ui';
import { activeChips } from './chips';
import { FACET_SINGULAR, inlineFacets } from './filterBarModel';
import {
  buildFacetDefs,
  CustomRangeDialog,
  FiltersPanel,
  TimeOriginControls,
  type FacetDef,
} from './FiltersPopover';
import { countActiveFilters, DEFAULT_VIEW, NONE, type RunsView } from './urlState';
import { useDebouncedSearch, type ViewPatch } from './useRunsView';
import styles from './FilterBar.module.css';

const PHONE_QUERY = '(max-width: 599px)';

/** Below 600 px the bar collapses to search plus one Filters button. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(PHONE_QUERY).matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function useWidth<T extends HTMLElement>(): [Ref<T>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function FacetTrigger({ def, onChange }: { def: FacetDef; onChange: (patch: ViewPatch) => void }) {
  const items = useMemo(() => def.options.map((o) => ({ key: o.value, label: o.label })), [def.options]);
  const value = useMemo(() => new Set<Key>(def.selected), [def.selected]);
  return (
    <MultiSelect
      triggerVariant="bar"
      panelTestId="filters-panel"
      label={FACET_SINGULAR[def.id] ?? def.label}
      items={items}
      value={value}
      searchable={items.length > 8}
      summary={(sel) =>
        sel.size === 1 ? (items.find((i) => sel.has(i.key))?.label ?? '1') : String(sel.size)
      }
      onChange={(next) => onChange(def.set([...next].map(String).filter((v) => v !== NONE)))}
    />
  );
}

function FacetRow({
  view,
  facets,
  owners,
  onChange,
  onClear,
  count,
}: {
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  onClear: () => void;
  count: number;
}) {
  const defs = useMemo(() => buildFacetDefs(view, facets, owners), [view, facets, owners]);
  const [rowRef, width] = useWidth<HTMLDivElement>();
  const inlineIds = useMemo(
    () =>
      new Set(
        inlineFacets(
          width,
          defs.map((d) => d.id),
        ),
      ),
    [width, defs],
  );
  const inline = defs.filter((d) => inlineIds.has(d.id));
  const more = defs.filter((d) => !inlineIds.has(d.id));
  const moreActive = more.reduce((n, d) => n + d.selected.length, 0);
  return (
    <div
      ref={rowRef}
      className={styles.facetRow}
      role="toolbar"
      aria-label="Runs filters"
      data-testid="filter-bar"
    >
      {inline.map((d) => (
        <FacetTrigger key={d.id} def={d} onChange={onChange} />
      ))}
      {more.length ? (
        <Popover
          label="More filters"
          placement="bottom start"
          trigger={
            <Button
              variant={moreActive ? 'accent' : 'neutral'}
              iconEnd={<Icon name="chevron-down" size={12} />}
              data-testid="filters-trigger"
              className={styles.more}
            >
              More filters{moreActive ? ` · ${moreActive}` : ''}
            </Button>
          }
        >
          <div className={styles.morePanel} data-testid="filters-panel">
            {more.map((d) => (
              <MoreFacet key={d.id} def={d} onChange={onChange} />
            ))}
          </div>
        </Popover>
      ) : null}
      {count > 0 ? (
        <Button variant="ghost" onPress={onClear} className={styles.clear}>
          Clear {count}
        </Button>
      ) : null}
    </div>
  );
}

function MoreFacet({ def, onChange }: { def: FacetDef; onChange: (patch: ViewPatch) => void }) {
  const items = useMemo(() => def.options.map((o) => ({ key: o.value, label: o.label })), [def.options]);
  const value = useMemo(() => new Set<Key>(def.selected), [def.selected]);
  return (
    <MultiSelect
      inline
      label={def.label}
      items={items}
      value={value}
      searchable={items.length > 8}
      onChange={(next) => onChange(def.set([...next].map(String).filter((v) => v !== NONE)))}
    />
  );
}

function ChipLine({
  view,
  owners,
  onChange,
  clear,
}: {
  view: RunsView;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  clear?: ReactNode;
}) {
  const chips = activeChips(view, (id) => owners[id] ?? id);
  if (!chips.length) return null;
  return (
    <div className={styles.chips} role="group" aria-label="Active filters">
      {chips.map((c) => (
        <Chip
          key={c.id}
          isSelected
          tone={c.tone}
          onRemove={() => onChange(c.remove)}
          removeLabel={`Remove ${c.label}`}
        >
          {c.label}
        </Chip>
      ))}
      {clear}
    </div>
  );
}

function PhoneFilters({
  view,
  facets,
  owners,
  onChange,
}: {
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
}) {
  const count = countActiveFilters(view) - (view.q ? 1 : 0);
  const [open, setOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  return (
    <>
      <Button
        variant={count ? 'accent' : 'neutral'}
        icon={<Icon name="list" size={12} />}
        data-testid="filters-trigger"
        onPress={() => setOpen(true)}
      >
        Filters{count ? ` · ${count}` : ''}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} title="Filters" width={360}>
        <FiltersPanel
          className={styles.drawerPanel}
          view={view}
          facets={facets}
          owners={owners}
          onChange={onChange}
          onCustomRange={() => {
            setOpen(false);
            setRangeOpen(true);
          }}
          onDone={() => setOpen(false)}
        />
      </Drawer>
      <CustomRangeDialog
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        from={view.from}
        to={view.to}
        onApply={(from, to) => onChange({ range: 'custom', from, to })}
      />
    </>
  );
}

function TimeOriginInline({ view, onChange }: { view: RunsView; onChange: (patch: ViewPatch) => void }) {
  const [rangeOpen, setRangeOpen] = useState(false);
  return (
    <>
      <div className={styles.inline}>
        <TimeOriginControls
          view={view}
          onChange={onChange}
          onCustomRange={() => setRangeOpen(true)}
          labels={false}
        />
      </div>
      <CustomRangeDialog
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        from={view.from}
        to={view.to}
        onApply={(from, to) => onChange({ range: 'custom', from, to })}
      />
    </>
  );
}

export interface FilterBarArgs {
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  searchRef?: Ref<HTMLInputElement>;
  /** The Charts page has no search box. */
  showSearch?: boolean;
}

/** The filter bar as DataTable.Toolbar slots: `search` and `filters` share row 1, `rows` are facets and chips. */
export function useFilterBarParts({
  view,
  facets,
  owners,
  onChange,
  searchRef,
  showSearch = true,
}: FilterBarArgs) {
  const phone = useIsPhone();
  const count = countActiveFilters(view);
  const search = useDebouncedSearch(view.q, (q) => onChange({ q }));
  const clear = () => onChange({ ...DEFAULT_VIEW, versioning: {}, sort: view.sort });
  return {
    search: showSearch ? (
      <SearchField
        ref={searchRef}
        label="Search runs"
        placeholder="Search runs"
        hint="/"
        value={search.text}
        onChange={search.change}
        onClear={() => search.flush('')}
        onSubmit={(v) => search.flush(v)}
        width={phone ? 200 : 260}
      />
    ) : null,
    filters: phone ? (
      <PhoneFilters view={view} facets={facets} owners={owners} onChange={onChange} />
    ) : (
      <TimeOriginInline view={view} onChange={onChange} />
    ),
    rows: (
      <>
        {phone ? null : (
          <FacetRow
            view={view}
            facets={facets}
            owners={owners}
            onChange={onChange}
            onClear={clear}
            count={count}
          />
        )}
        <ChipLine
          view={view}
          owners={owners}
          onChange={onChange}
          clear={
            phone && count > 0 ? (
              <Button variant="ghost" onPress={clear}>
                Clear {count}
              </Button>
            ) : undefined
          }
        />
      </>
    ),
  };
}
