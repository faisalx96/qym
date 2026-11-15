/**
 * The Reviews filter bar, on the runs filter bar's pattern (C152): Source as a segmented control beside the search,
 * then one bar trigger per facet (Task, Dataset, Model, Run, Confidence) with its value written on it, and one red
 * `Clear n` after them. No "Filters" popover and no chip line: each trigger already names its value.
 */
import { useMemo } from 'react';
import type { Key } from 'react-aria-components';
import { BarTrigger, ClearFiltersButton, MultiSelect, Popover, SegmentedControl, Slider } from '@/ui';
import type { CorrectionsPage, ReviewFilters, ReviewSource } from '@/api/reviews';
import styles from './FilterBar.module.css';

type Multi = 'task' | 'dataset' | 'model' | 'run';
const FACETS: {
  key: Multi;
  label: string;
  list: keyof Pick<CorrectionsPage, 'tasks' | 'datasets' | 'models' | 'run_names'>;
  counts: keyof CorrectionsPage['facet_counts'];
}[] = [
  { key: 'task', label: 'Task', list: 'tasks', counts: 'task' },
  { key: 'dataset', label: 'Dataset', list: 'datasets', counts: 'dataset' },
  { key: 'model', label: 'Model', list: 'models', counts: 'model' },
  { key: 'run', label: 'Run', list: 'run_names', counts: 'run_name' },
];
/** Match nothing: every box unticked (the URL keeps an empty list). */
const NONE = '__none__';

/** Filters set on the bar, the search included (what `Clear n` resets). */
export function activeFilterCount(f: ReviewFilters): number {
  return [f.search, f.source, f.confMin > 0 || f.confMax < 100, f.task, f.dataset, f.model, f.run].filter(
    Boolean,
  ).length;
}

/** All · AI only · Human only · AI+Human corrected, next to the search (as Time and Origin on Runs). */
export function SourceControl({
  filters,
  onChange,
}: {
  filters: ReviewFilters;
  onChange: (patch: Partial<ReviewFilters>) => void;
}) {
  return (
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
  );
}

function FacetTrigger({
  facet,
  filters,
  facets,
  onChange,
}: {
  facet: (typeof FACETS)[number];
  filters: ReviewFilters;
  facets: CorrectionsPage | undefined;
  onChange: (patch: Partial<ReviewFilters>) => void;
}) {
  const values = facets?.[facet.list] ?? [];
  const counts = facets?.facet_counts?.[facet.counts] ?? {};
  const items = values.map((v) => ({ key: v, label: v, count: counts[v] }));
  const current = filters[facet.key];
  const value = useMemo(
    () => new Set<Key>(current === null ? [] : current.length ? current : [NONE]),
    [current],
  );
  return (
    <MultiSelect
      triggerVariant="bar"
      label={facet.label}
      items={items}
      value={value}
      emptyMeansAll
      noneKey={NONE}
      summary={(sel) => (sel.has(NONE) ? 'None' : sel.size === 1 ? String([...sel][0]) : String(sel.size))}
      onChange={(next) => {
        const keys = [...next].map(String);
        onChange({
          [facet.key]: keys.length === 0 ? null : keys.includes(NONE) ? [] : keys,
        } as Partial<ReviewFilters>);
      }}
    />
  );
}

function ConfidenceTrigger({
  filters,
  onChange,
}: {
  filters: ReviewFilters;
  onChange: (patch: Partial<ReviewFilters>) => void;
}) {
  const set = filters.confMin > 0 || filters.confMax < 100;
  return (
    <Popover
      label="Confidence"
      placement="bottom start"
      trigger={
        <BarTrigger
          label="Confidence"
          value={set ? `${filters.confMin}–${filters.confMax}%` : undefined}
          active={set}
          data-testid="confidence-trigger"
        />
      }
    >
      <div className={styles.band} role="group" aria-label="Confidence band">
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
    </Popover>
  );
}

/** The second row: one trigger per facet, then `× Clear n` (red, as on Runs) when anything is set. */
export function FacetRow({
  filters,
  facets,
  onChange,
  onClear,
}: {
  filters: ReviewFilters;
  facets: CorrectionsPage | undefined;
  onChange: (patch: Partial<ReviewFilters>) => void;
  onClear: () => void;
}) {
  const count = activeFilterCount(filters);
  return (
    <div className={styles.facetRow} role="toolbar" aria-label="Issue filters" data-testid="filter-bar">
      {FACETS.map((f) => (
        <FacetTrigger key={f.key} facet={f} filters={filters} facets={facets} onChange={onChange} />
      ))}
      <ConfidenceTrigger filters={filters} onChange={onChange} />
      <ClearFiltersButton count={count} onClear={onClear} testId="clear-filters" />
    </div>
  );
}
