import { useEffect, useRef, useState } from 'react';
import { liveTurnsQuery, type LiveFilters, type LiveMetricSpec, type LiveTurnsPage } from '@/api/live';
import { useSearchParamsState, type QueryUpdates } from '@/lib/url-state';
import { BarTrigger, Chip, ClearFiltersButton, MultiSelect, NumberField, SearchField, Select } from '@/ui';
import { filterChips } from '../lib/filters';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../turns.module.css';

interface TurnFiltersProps {
  filters: LiveFilters;
  facets: LiveTurnsPage['facets'] | undefined;
  specs: LiveMetricSpec[];
  dayCount?: number;
}

export function TurnFilters({ filters, facets, specs, dayCount }: TurnFiltersProps) {
  const { replaceUrlQuery } = useSearchParamsState();
  const update = (updates: QueryUpdates) => replaceUrlQuery({ ...updates, page: null });
  const chips = filterChips(filters, facets, specs);
  const diagnosis = diagnosisSpec(specs);
  const labelValues = new Set([
    ...(diagnosis?.values ?? []).flatMap((item) => (typeof item.value === 'string' ? [item.value] : [])),
    ...Object.keys(facets?.labels ?? {}),
    ...(filters.labels ?? []),
  ]);
  // Every spec value is listed, including values whose current result count is zero.
  const labels = mixSegments(Object.fromEntries([...labelValues].map((value) => [value, 1])), diagnosis);
  const services = [
    ...new Set([...Object.keys(facets?.services ?? {}), ...(filters.service ? [filters.service] : [])]),
  ];
  const serviceName = (name: string) =>
    specs.find((spec) => spec.metric_name === `service.${name}`)?.label ?? name;
  const removeChip = (onRemove: (f: LiveFilters) => LiveFilters) => {
    const next = liveTurnsQuery(onRemove(filters));
    const keys = new Set([...liveTurnsQuery(filters).keys(), ...next.keys()]);
    update(Object.fromEntries([...keys].map((key) => [key, next.has(key) ? next.getAll(key) : null])));
  };
  const countLabel = (label: string, count: number) => (
    <>
      {label} <span className={styles.number}>{count}</span>
    </>
  );
  // Metric and Service open their fields in one row under the bar: closed on load, one row at a time.
  const [openRow, setOpenRow] = useState<'metric' | 'service' | null>(null);
  const toggleRow = (row: 'metric' | 'service') => setOpenRow((current) => (current === row ? null : row));

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
  const metricValue = filters.metric
    ? `${specs.find((spec) => spec.metric_name === filters.metric)?.label ?? filters.metric}${filters.min === undefined ? '' : ` ≥ ${filters.min}`}${filters.max === undefined ? '' : ` ≤ ${filters.max}`}`
    : undefined;
  const serviceValue = filters.service
    ? `${serviceName(filters.service)}${filters.service_status ? ` · ${filters.service_status.replaceAll('_', ' ')}` : ''}`
    : undefined;
  // X07: each set filter counts 1 (a date range is one filter), the search text counts 1.
  const count = [
    filters.day || filters.from || filters.to,
    filters.labels?.length,
    filters.modes?.length,
    filters.statuses?.length,
    filters.outcomes?.length,
    filters.metric,
    filters.service,
    filters.charts,
    filters.user,
    filters.conversation,
    filters.q,
  ].filter(Boolean).length;
  const clearAll = () => {
    clearTimeout(timer.current);
    setSearch('');
    setOpenRow(null);
    update({
      day: null,
      from: null,
      to: null,
      label: null,
      status: null,
      outcome: null,
      mode: null,
      metric: null,
      min: null,
      max: null,
      service: null,
      service_status: null,
      charts: null,
      user: null,
      conversation: null,
      q: null,
    });
  };

  return (
    <div className={styles.filterBlock} data-live-block="filters">
      <SearchField
        label="Search questions and answers"
        placeholder="Search question or answer"
        width="var(--search-width)"
        shortcut="/"
        value={search}
        onChange={searchChange}
        inputProps={{ dir: 'auto' }}
      />
      <div className={styles.filters} role="group" aria-label="Turn filters">
        {chips
          .filter((chip) => ['day', 'from', 'user', 'conversation'].includes(chip.key))
          .map((chip) =>
            chip.key === 'day' || chip.key === 'from' ? (
              <MultiSelect
                key={chip.key}
                label="Day"
                triggerVariant="bar"
                searchable={false}
                selectAll={false}
                onlyAction={false}
                items={[{ key: chip.key, label: chip.label, count: chip.key === 'day' ? dayCount : undefined }]}
                value={new Set([chip.key])}
                onChange={(next) => {
                  if (!next.size) removeChip(chip.onRemove);
                }}
              />
            ) : (
              // User and conversation come from a link in the table, not from this bar: they keep their chip.
              <Chip
                key={chip.key}
                isSelected
                onChange={() => removeChip(chip.onRemove)}
                onRemove={() => removeChip(chip.onRemove)}
                removeLabel={`Remove ${chip.label}`}
              >
                <span dir="auto">{chip.label}</span>
              </Chip>
            ),
          )}
        <MultiSelect
          label="Diagnosis"
          triggerVariant="bar"
          emptyMeansAll
          items={labels.map((item) => ({
            key: item.value,
            label: item.label,
            count: facets?.labels[item.value] ?? 0,
          }))}
          value={new Set(filters.labels ?? [])}
          onChange={(next) => update({ label: next.size ? [...next].map(String) : null })}
        />
        {(['modes', 'statuses', 'outcomes'] as const).map((field) => {
          const label = field === 'modes' ? 'Mode' : field === 'statuses' ? 'Status' : 'Outcome';
          const key = field === 'modes' ? 'mode' : field === 'statuses' ? 'status' : 'outcome';
          const selected = filters[field] ?? [];
          const values = [...new Set([...Object.keys(facets?.[field] ?? {}), ...selected])].map((value) => ({
            key: value,
            label:
              field === 'statuses'
                ? value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
                : value.replaceAll('_', ' '),
            count: facets?.[field][value] ?? 0,
          }));
          return (
            <MultiSelect
              key={field}
              label={label}
              triggerVariant="bar"
              emptyMeansAll
              items={values}
              value={new Set(selected)}
              onChange={(next) => update({ [key]: next.size ? [...next].map(String) : null })}
            />
          );
        })}
        <BarTrigger
          label="Metric"
          value={metricValue}
          active={Boolean(filters.metric)}
          aria-expanded={openRow === 'metric'}
          onPress={() => toggleRow('metric')}
        />
        <BarTrigger
          label="Service"
          value={serviceValue}
          active={Boolean(filters.service)}
          aria-expanded={openRow === 'service'}
          onPress={() => toggleRow('service')}
        />
        <Select
          label="Charts"
          hideLabel
          triggerVariant="bar"
          value={filters.charts ?? ''}
          items={[
            { key: '', label: 'All turns' },
            { key: 'any', label: 'Any charts' },
            { key: 'failed', label: 'Failed charts' },
            { key: 'none', label: 'No charts' },
          ]}
          onChange={(value) => update({ charts: value ? String(value) : null })}
        />
        <ClearFiltersButton count={count} onClear={clearAll} />
      </div>
      {openRow === 'metric' ? (
        <div className={styles.filterFields} role="group" aria-label="Metric bounds">
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
            onChange={(value) => update({ min: Number.isFinite(value) ? value : null })}
          />
          <NumberField
            label="Maximum"
            value={filters.max ?? NaN}
            isDisabled={!filters.metric}
            minValue={filters.min}
            step={0.01}
            steppers={false}
            onChange={(value) => update({ max: Number.isFinite(value) ? value : null })}
          />
        </div>
      ) : null}
      {openRow === 'service' ? (
        <div className={styles.filterFields} role="group" aria-label="Service filter">
          <Select
            label="Service"
            value={filters.service ?? ''}
            items={[
              { key: '', label: 'Any service', count: undefined },
              ...services.map((value) => ({
                key: value,
                label: serviceName(value),
                count: facets?.services[value] ?? 0,
              })),
            ]}
            renderItem={(item) => (item.count === undefined ? item.label : countLabel(item.label, item.count))}
            renderValue={(item) => (item.count === undefined ? item.label : countLabel(item.label, item.count))}
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
        </div>
      ) : null}
    </div>
  );
}
