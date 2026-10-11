/** One-row command bar: search, Filters popover, active-filter chips, Columns, Select. */
import type { ReactNode, Ref } from 'react';
import type { Facets } from '@/api/dashboardTypes';
import { Button, Chip, SearchField } from '@/ui';
import { activeChips } from './chips';
import { FiltersPopover } from './FiltersPopover';
import { countActiveFilters, DEFAULT_VIEW, type RunsView } from './urlState';
import { useDebouncedSearch, type ViewPatch } from './useRunsView';
import styles from './RunsPage.module.css';

export function RunsToolbar({
  mode,
  view,
  facets,
  owners,
  onChange,
  searchRef,
  end,
}: {
  mode: 'runs' | 'charts';
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  searchRef?: Ref<HTMLInputElement>;
  end?: ReactNode;
}) {
  const count = countActiveFilters(view);
  const chips = activeChips(view, (id) => owners[id] ?? id);
  const search = useDebouncedSearch(view.q, (q) => onChange({ q }));
  const clear = () => onChange({ ...DEFAULT_VIEW, versioning: {}, sort: view.sort });
  return (
    <div
      className={styles.commandBar}
      role="toolbar"
      aria-label={`${mode === 'runs' ? 'Runs' : 'Charts'} toolbar`}
    >
      {mode === 'runs' ? (
        <SearchField
          ref={searchRef}
          label="Search runs"
          placeholder="Search runs"
          hint="/"
          value={search.text}
          onChange={search.change}
          onClear={() => search.flush('')}
          onSubmit={(v) => search.flush(v)}
          width={260}
        />
      ) : null}
      <FiltersPopover view={view} facets={facets} owners={owners} onChange={onChange} />
      {chips.length ? (
        <div className={styles.chips} role="group" aria-label="Active filters">
          {chips.map((c) => (
            <Chip key={c.id} isSelected onRemove={() => onChange(c.remove)} removeLabel={`Remove ${c.label}`}>
              {c.label}
            </Chip>
          ))}
          <Button variant="ghost" onPress={clear}>
            Clear {count}
          </Button>
        </div>
      ) : null}
      {end ? <div className={styles.barEnd}>{end}</div> : null}
    </div>
  );
}
