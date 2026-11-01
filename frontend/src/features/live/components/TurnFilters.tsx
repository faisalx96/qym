import { useEffect, useRef, useState, type ReactNode } from 'react';
import { liveTurnsQuery, type LiveFilters, type LiveMetricSpec, type LiveTurnsPage } from '@/api/live';
import { useSearchParamsState, type QueryUpdates } from '@/lib/url-state';
import {
  Button,
  Chip,
  IconButton,
  NumberField,
  Popover,
  QuickFilterGroup,
  SearchField,
  Select,
  Text,
} from '@/ui';
import { filterChips } from '../lib/filters';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../turns.module.css';

interface TurnFiltersProps {
  filters: LiveFilters;
  facets: LiveTurnsPage['facets'] | undefined;
  specs: LiveMetricSpec[];
  dayCount?: number;
}

function FilterControl({
  label,
  active,
  clear,
  children,
  tone,
}: {
  label: string;
  active: boolean;
  clear: () => void;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div className={styles.filterControl} data-tone={tone} data-live-filter={label}>
      <Text variant="sm" tone="muted" weight={650}>
        {label}
      </Text>
      <div className={styles.trigger}>
        {children}
        {active ? <IconButton label={`Clear ${label}`} icon="close" onPress={clear} /> : null}
      </div>
    </div>
  );
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
  // Tones belong to the spec, including filters whose current result count is zero.
  const labels = mixSegments(Object.fromEntries([...labelValues].map((value) => [value, 1])), diagnosis);
  const services = [
    ...new Set([...Object.keys(facets?.services ?? {}), ...(filters.service ? [filters.service] : [])]),
  ];
  const toggle = (key: string, selected: string[], value: string) => {
    update({
      [key]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    });
  };
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
  const facetSelect = (
    label: string,
    key: string,
    selected: string[],
    values: { key: string; label: string; count: number }[],
  ) => {
    const items = [
      { key: '', label: `Any ${label.toLowerCase()}`, count: undefined },
      ...values,
      // Preserve every value in a multi-value deep link until the user replaces or clears it.
      ...(selected.length > 1
        ? [
            {
              key: JSON.stringify(selected),
              label: selected
                .map((value) => values.find((item) => item.key === value)?.label ?? value)
                .join(', '),
              count: values
                .filter((item) => selected.includes(item.key))
                .reduce((sum, item) => sum + item.count, 0),
            },
          ]
        : []),
    ];
    return (
      <Select
        label={label}
        hideLabel
        items={items}
        value={selected.length > 1 ? JSON.stringify(selected) : (selected[0] ?? '')}
        onChange={(value) => update({ [key]: value ? [String(value)] : null })}
        renderItem={(item) => (item.count === undefined ? item.label : countLabel(item.label, item.count))}
        renderValue={(item) => (item.count === undefined ? item.label : countLabel(item.label, item.count))}
      />
    );
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
  const metricLabel = filters.metric
    ? `${specs.find((spec) => spec.metric_name === filters.metric)?.label ?? filters.metric}${filters.min === undefined ? '' : ` ≥ ${filters.min}`}${filters.max === undefined ? '' : ` ≤ ${filters.max}`}`
    : 'Any metric';
  const serviceLabel = filters.service
    ? `${filters.service}${filters.service_status ? ` · ${filters.service_status.replaceAll('_', ' ')}` : ''}`
    : 'Any service';
  const serviceCount = filters.service ? (facets?.services[filters.service] ?? 0) : undefined;

  return (
    <div className={styles.filterBlock} data-live-block="filters">
      <div className={styles.filters} role="group" aria-label="Turn filters">
        {chips
          .filter((chip) => ['day', 'from', 'user', 'conversation'].includes(chip.key))
          .map((chip) => (
            <div key={chip.key} className={styles.filterControl} data-live-filter={chip.key}>
              <Text variant="sm" tone="muted" weight={650}>
                {chip.key === 'day' || chip.key === 'from' ? 'Day (UTC)' : chip.key}
              </Text>
              <Chip
                isSelected
                count={chip.key === 'day' ? dayCount : undefined}
                onChange={() => removeChip(chip.onRemove)}
                onRemove={() => removeChip(chip.onRemove)}
                removeLabel={`Remove ${chip.label}`}
              >
                <span dir="auto">{chip.label}</span>
              </Chip>
            </div>
          ))}
        <FilterControl
          label="Diagnosis"
          active={Boolean(filters.labels?.length)}
          clear={() => update({ label: null })}
          tone={labels.find((item) => filters.labels?.includes(item.value))?.tone}
        >
          {facetSelect(
            'Diagnosis',
            'label',
            filters.labels ?? [],
            labels.map((item) => ({
              key: item.value,
              label: item.label,
              count: facets?.labels[item.value] ?? 0,
            })),
          )}
        </FilterControl>
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
          const picked = values.filter((item) => selected.includes(item.key));
          const visibleValue = picked.length
            ? picked.map((item) => item.label).join(', ')
            : `Any ${label.toLowerCase()}`;
          const count = picked.length ? picked.reduce((sum, item) => sum + item.count, 0) : undefined;
          return (
            <FilterControl
              key={field}
              label={label}
              active={selected.length > 0}
              clear={() => update({ [key]: null })}
            >
              {values.length > 5 ? (
                facetSelect(label, key, selected, values)
              ) : (
                <Popover
                  label={`Choose ${label}`}
                  trigger={
                    <Button aria-label={`${label}: ${visibleValue}${count === undefined ? '' : ` ${count}`}`}>
                      {count === undefined ? visibleValue : countLabel(visibleValue, count)}
                    </Button>
                  }
                >
                  <QuickFilterGroup
                    label={label}
                    mode="multi"
                    options={values.map((item) => ({ id: item.key, label: item.label, count: item.count }))}
                    selected={selected}
                    onToggle={(value) => toggle(key, selected, value)}
                  />
                  {!values.length ? <Text tone="muted">No values available</Text> : null}
                </Popover>
              )}
            </FilterControl>
          );
        })}
        <FilterControl
          label="Metric"
          active={Boolean(filters.metric)}
          clear={() => update({ metric: null, min: null, max: null })}
        >
          <Popover
            label="Metric bounds"
            trigger={<Button aria-label={`Metric: ${metricLabel}`}>{metricLabel}</Button>}
          >
            {({ close }) => (
              <div className={styles.filterFields}>
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
                <Button onPress={close}>Done</Button>
              </div>
            )}
          </Popover>
        </FilterControl>
        <FilterControl
          label="Service"
          active={Boolean(filters.service)}
          clear={() => update({ service: null, service_status: null })}
        >
          <Popover
            label="Service filter"
            trigger={
              <Button
                aria-label={`Service: ${serviceLabel}${serviceCount === undefined ? '' : ` ${serviceCount}`}`}
              >
                {serviceCount === undefined ? serviceLabel : countLabel(serviceLabel, serviceCount)}
              </Button>
            }
          >
            {({ close }) => (
              <div className={styles.filterFields}>
                <Select
                  label="Service"
                  value={filters.service ?? ''}
                  items={[
                    { key: '', label: 'Any service' },
                    ...services.map((value) => ({ key: value, label: value })),
                  ]}
                  onChange={(value) =>
                    update({ service: value ? String(value) : null, service_status: null })
                  }
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
                <Button onPress={close}>Done</Button>
              </div>
            )}
          </Popover>
        </FilterControl>
        <FilterControl label="Charts" active={Boolean(filters.charts)} clear={() => update({ charts: null })}>
          <Select
            label="Charts"
            hideLabel
            value={filters.charts ?? ''}
            items={[
              { key: '', label: 'All turns' },
              { key: 'any', label: 'Any charts' },
              { key: 'failed', label: 'Failed charts' },
              { key: 'none', label: 'No charts' },
            ]}
            onChange={(value) => update({ charts: value ? String(value) : null })}
          />
        </FilterControl>
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
  );
}
