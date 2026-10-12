/** One "Filters" popover: facet multiselects, source, confidence band; active filters show as removable chips. */
import { useMemo } from 'react';
import type { Key } from 'react-aria-components';
import { Button, Chip, MultiSelect, SegmentedControl, Slider } from '@/ui';
import type { CorrectionsPage, ReviewFilters, ReviewSource } from '@/api/reviews';
import styles from './FiltersPopover.module.css';

type Multi = 'task' | 'dataset' | 'model' | 'run';
const FACETS: {
  key: Multi;
  label: string;
  list: keyof Pick<CorrectionsPage, 'tasks' | 'datasets' | 'models' | 'run_names'>;
  counts: keyof CorrectionsPage['facet_counts'];
}[] = [
  { key: 'task', label: 'Tasks', list: 'tasks', counts: 'task' },
  { key: 'dataset', label: 'Datasets', list: 'datasets', counts: 'dataset' },
  { key: 'model', label: 'Models', list: 'models', counts: 'model' },
  { key: 'run', label: 'Runs', list: 'run_names', counts: 'run_name' },
];
const SOURCE_LABEL: Record<ReviewSource, string> = {
  ai_only: 'AI only',
  human_only: 'Human only',
  corrected: 'AI+Human corrected',
};

export function activeFilterCount(f: ReviewFilters): number {
  return [f.source, f.confMin > 0 || f.confMax < 100, f.task, f.dataset, f.model, f.run].filter(Boolean)
    .length;
}

export function FiltersToggle({
  filters,
  open,
  onToggle,
}: {
  filters: ReviewFilters;
  open: boolean;
  onToggle: () => void;
}) {
  const n = activeFilterCount(filters);
  return (
    <Button
      variant="neutral"
      size="sm"
      onPress={onToggle}
      aria-expanded={open}
      aria-controls="reviews-filters-panel"
      data-testid="filters-trigger"
      iconEnd={<span aria-hidden="true">{open ? '▴' : '▾'}</span>}
    >
      Filters{n ? ` (${n})` : ''}
    </Button>
  );
}

/** Inline panel (a nested popover inside a popover would close its parent). */
export function FiltersPanel({
  filters,
  facets,
  onChange,
}: {
  filters: ReviewFilters;
  facets: CorrectionsPage | undefined;
  onChange: (patch: Partial<ReviewFilters>) => void;
}) {
  return (
    <div className={styles.panel} id="reviews-filters-panel" role="group" aria-label="Filters">
      {FACETS.map((f) => {
        const values = facets?.[f.list] ?? [];
        const counts = facets?.facet_counts?.[f.counts] ?? {};
        const items = values.map((v) => ({ key: v, label: v, count: counts[v] }));
        const current = filters[f.key];
        return (
          <MultiSelect
            key={f.key}
            label={f.label}
            items={items}
            value={new Set<Key>(current === null ? values : current)}
            placeholder="All"
            onChange={(keys) =>
              onChange({
                [f.key]: keys.size === values.length ? null : [...keys].map(String),
              } as Partial<ReviewFilters>)
            }
          />
        );
      })}
      <SegmentedControl<'all' | ReviewSource>
        label="Source"
        value={filters.source ?? 'all'}
        options={[
          { value: 'all', label: 'All' },
          { value: 'ai_only', label: 'AI only' },
          { value: 'human_only', label: 'Human only' },
          { value: 'corrected', label: 'AI+Human corrected' },
        ]}
        onChange={(v) => onChange({ source: v === 'all' ? null : v })}
      />
      <div className={styles.band}>
        <Slider
          label="Confidence min"
          unit="%"
          minValue={0}
          maxValue={100}
          step={5}
          value={filters.confMin}
          onChange={(v) => onChange({ confMin: Math.min(v, filters.confMax) })}
        />
        <Slider
          label="Confidence max"
          unit="%"
          minValue={0}
          maxValue={100}
          step={5}
          value={filters.confMax}
          onChange={(v) => onChange({ confMax: Math.max(v, filters.confMin) })}
        />
      </div>
    </div>
  );
}

export function FilterChips({
  filters,
  onChange,
}: {
  filters: ReviewFilters;
  onChange: (patch: Partial<ReviewFilters>) => void;
}) {
  const chips = useMemo(() => {
    const out: { id: string; label: string; clear: Partial<ReviewFilters> }[] = [];
    if (filters.source)
      out.push({ id: 'source', label: SOURCE_LABEL[filters.source], clear: { source: null } });
    if (filters.confMin > 0 || filters.confMax < 100)
      out.push({
        id: 'conf',
        label: `Confidence ${filters.confMin}–${filters.confMax}%`,
        clear: { confMin: 0, confMax: 100 },
      });
    for (const f of FACETS) {
      const v = filters[f.key];
      if (v !== null)
        out.push({
          id: f.key,
          label: `${f.label}: ${v.length ? (v.length > 2 ? `${v.length} selected` : v.join(', ')) : 'none'}`,
          clear: { [f.key]: null } as Partial<ReviewFilters>,
        });
    }
    return out;
  }, [filters]);
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <Chip
          key={c.id}
          isSelected
          onRemove={() => onChange(c.clear)}
          removeLabel={`Remove filter ${c.label}`}
          data-filter-chip={c.id}
        >
          {c.label}
        </Chip>
      ))}
    </>
  );
}
