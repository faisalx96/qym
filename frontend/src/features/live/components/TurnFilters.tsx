import { useEffect, useRef, useState } from 'react';
import { liveTurnsQuery, type LiveFilters, type LiveMetricSpec, type LiveTurnsPage } from '@/api/live';
import { useSearchParamsState, type QueryUpdates } from '@/lib/url-state';
import { Chip, NumberField, QuickFilterGroup, SearchField, Select } from '@/ui';
import { filterChips } from '../lib/filters';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../turns.module.css';

interface TurnFiltersProps {
  filters: LiveFilters;
  facets: LiveTurnsPage['facets'] | undefined;
  specs: LiveMetricSpec[];
}

export function TurnFilters({ filters, facets, specs }: TurnFiltersProps) {
  const { replaceUrlQuery } = useSearchParamsState();
  const update = (updates: QueryUpdates) => replaceUrlQuery({ ...updates, page: null });
  const chips = filterChips(filters, facets, specs);
  const diagnosis = diagnosisSpec(specs);
  const labelValues = new Set([
    ...(diagnosis?.values ?? []).flatMap((item) => (typeof item.value === 'string' ? [item.value] : [])),
    ...Object.keys(facets?.labels ?? {}),
    ...(filters.labels ?? []),
  ]);
  // Tones belong to the spec, including filters whose current result count is zero.
  const labels = mixSegments(Object.fromEntries([...labelValues].map((value) => [value, 1])), diagnosis);
  const modes = [...new Set([...Object.keys(facets?.modes ?? {}), ...(filters.modes ?? [])])];
  const statuses = [...new Set([...Object.keys(facets?.statuses ?? {}), ...(filters.statuses ?? [])])];
  const outcomes = [...new Set([...Object.keys(facets?.outcomes ?? {}), ...(filters.outcomes ?? [])])];
  const services = [
    ...new Set([...Object.keys(facets?.services ?? {}), ...(filters.service ? [filters.service] : [])]),
  ];
  const toggle = (key: string, selected: string[] | undefined, value: string) => {
    update({
      [key]: selected?.includes(value)
        ? selected.filter((item) => item !== value)
        : [...(selected ?? []), value],
    });
  };
  const removeChip = (onRemove: (f: LiveFilters) => LiveFilters) => {
    const next = liveTurnsQuery(onRemove(filters));
    const keys = new Set([...liveTurnsQuery(filters).keys(), ...next.keys()]);
    update(Object.fromEntries([...keys].map((key) => [key, next.has(key) ? next.getAll(key) : null])));
  };

  const [search, setSearch] = useState(filters.q ?? '');
  const [seenSearch, setSeenSearch] = useState(filters.q);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const replaceQuery = useRef(replaceUrlQuery);
  useEffect(() => {
    replaceQuery.current = replaceUrlQuery;
  }, [replaceUrlQuery]);
  if (seenSearch !== filters.q) {
    setSeenSearch(filters.q);
    setSearch(filters.q ?? '');
  }
  useEffect(() => {
    clearTimeout(timer.current);
    return () => clearTimeout(timer.current);
  }, [filters.q]);
  const searchChange = (value: string) => {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => replaceQuery.current({ q: value.trim() || null, page: null }), 300);
  };

  return (
    <div className={styles.filterBlock} data-live-block="filters">
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="Active filters">
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              isSelected
              tone={
                chip.key.startsWith('labels:')
                  ? labels.find((item) => `labels:${item.value}` === chip.key)?.tone
                  : 'neutral'
              }
              onChange={() => removeChip(chip.onRemove)}
              onRemove={() => removeChip(chip.onRemove)}
              removeLabel={`Remove ${chip.label}`}
            >
              <span dir="auto">{chip.label}</span>
            </Chip>
          ))}
        </div>
        <SearchField
          label="Search questions and answers"
          placeholder="Search question or answer"
          className={styles.search}
          value={search}
          onChange={searchChange}
          inputProps={{ dir: 'auto' }}
        />
      </div>
      <div className={styles.filters}>
        <QuickFilterGroup
          label="Diagnosis"
          mode="multi"
          options={[...labelValues].map((value) => {
            const label = diagnosis?.values?.find((item) => item.value === value)?.label;
            return {
              id: value,
              label: typeof label === 'string' ? label : value,
              count: facets?.labels[value] ?? 0,
            };
          })}
          selected={filters.labels ?? []}
          onToggle={(value) => toggle('label', filters.labels, value)}
        />
        <QuickFilterGroup
          label="Status"
          mode="multi"
          options={statuses.map((value) => ({
            id: value,
            label: value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()),
            count: facets?.statuses[value] ?? 0,
          }))}
          selected={filters.statuses ?? []}
          onToggle={(value) => toggle('status', filters.statuses, value)}
        />
        <QuickFilterGroup
          label="Outcome"
          mode="multi"
          options={outcomes.map((value) => ({
            id: value,
            label: value.replaceAll('_', ' '),
            count: facets?.outcomes[value] ?? 0,
          }))}
          selected={filters.outcomes ?? []}
          onToggle={(value) => toggle('outcome', filters.outcomes, value)}
        />
        <QuickFilterGroup
          label="Mode"
          mode="multi"
          options={modes.map((value) => ({ id: value, label: value, count: facets?.modes[value] ?? 0 }))}
          selected={filters.modes ?? []}
          onToggle={(value) => toggle('mode', filters.modes, value)}
        />
      </div>
      <div className={styles.filters}>
        <Select
          label="Metric"
          items={[
            { key: '', label: 'Any metric' },
            ...specs
              .filter((spec) => spec.score_type !== 'categorical')
              .map((spec) => ({ key: spec.metric_name, label: spec.label })),
          ]}
          value={filters.metric ?? ''}
          onChange={(value) => update({ metric: value ? String(value) : null, min: null, max: null })}
        />
        <NumberField
          label="Minimum"
          value={filters.min ?? NaN}
          isDisabled={!filters.metric}
          maxValue={filters.max}
          step={0.01}
          steppers={false}
          className={styles.bound}
          onChange={(value) => update({ min: Number.isFinite(value) ? value : null })}
        />
        <NumberField
          label="Maximum"
          value={filters.max ?? NaN}
          isDisabled={!filters.metric}
          minValue={filters.min}
          step={0.01}
          steppers={false}
          className={styles.bound}
          onChange={(value) => update({ max: Number.isFinite(value) ? value : null })}
        />
        <Select
          label="Service"
          value={filters.service ?? ''}
          items={[
            { key: '', label: 'Any service' },
            ...services.map((value) => ({ key: value, label: value })),
          ]}
          onChange={(value) => update({ service: value ? String(value) : null, service_status: null })}
        />
        <Select
          label="Service status"
          value={filters.service_status ?? ''}
          isDisabled={!filters.service}
          items={[
            { key: '', label: 'Any status' },
            { key: 'ok', label: 'OK' },
            { key: 'not_ok', label: 'Not OK' },
          ]}
          onChange={(value) => update({ service_status: value ? String(value) : null })}
        />
        <Select
          label="Charts"
          value={filters.charts ?? ''}
          items={[
            { key: '', label: 'All turns' },
            { key: 'any', label: 'Any charts' },
            { key: 'failed', label: 'Failed charts' },
            { key: 'none', label: 'No charts' },
          ]}
          onChange={(value) => update({ charts: value ? String(value) : null })}
        />
      </div>
    </div>
  );
}
