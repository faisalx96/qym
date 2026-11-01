import type { LiveFilters, LiveMetricSpec, LiveTurnsPage } from '@/api/live';
import { diagnosisSpec } from './mix';

interface FilterChip {
  key: string;
  label: string;
  onRemove: (filters: LiveFilters) => LiveFilters;
}

export function filterChips(
  filters: LiveFilters,
  _facets: LiveTurnsPage['facets'] | undefined,
  specs: LiveMetricSpec[],
): FilterChip[] {
  const chips: FilterChip[] = [];
  const remove = (f: LiveFilters, ...keys: (keyof LiveFilters)[]): LiveFilters => {
    const next = { ...f };
    for (const key of [...keys, 'page'] as const) delete next[key];
    return next;
  };
  const add = (key: keyof LiveFilters, label: string, ...related: (keyof LiveFilters)[]) => {
    chips.push({ key, label, onRemove: (f) => remove(f, key, ...related) });
  };
  const dateLabel = (day: string) => {
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isNaN(date.getTime())
      ? day
      : date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
  };
  if (filters.day) add('day', dateLabel(filters.day));
  if (filters.from || filters.to) {
    add(
      'from',
      filters.from && filters.to
        ? `${dateLabel(filters.from)} – ${dateLabel(filters.to)}`
        : filters.from
          ? `From ${dateLabel(filters.from)}`
          : `Until ${dateLabel(filters.to!)}`,
      'to',
    );
  }
  const values = diagnosisSpec(specs)?.values;
  const groups = [
    ['labels', 'Diagnosis'],
    ['statuses', 'Status'],
    ['outcomes', 'Outcome'],
    ['modes', 'Mode'],
  ] as const;
  for (const [key, title] of groups) {
    for (const value of filters[key] ?? []) {
      const plainLabel = key === 'labels' ? values?.find((item) => item.value === value)?.label : undefined;
      const label =
        typeof plainLabel === 'string'
          ? plainLabel
          : key === 'statuses' || key === 'outcomes'
            ? value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
            : value;
      chips.push({
        key: `${key}:${value}`,
        label: `${title}: ${label}`,
        onRemove: (f) => {
          const next = remove(f, key);
          const remaining = f[key]?.filter((item) => item !== value);
          if (remaining?.length) next[key] = remaining;
          return next;
        },
      });
    }
  }
  if (filters.metric) {
    for (const [key, symbol, other] of [
      ['min', '≥', 'max'],
      ['max', '≤', 'min'],
    ] as const) {
      if (filters[key] === undefined) continue;
      chips.push({
        key,
        label: `${filters.metric} ${symbol} ${filters[key]}`,
        onRemove: (f) => remove(f, key, ...(f[other] === undefined ? ['metric' as const] : [])),
      });
    }
    if (filters.min === undefined && filters.max === undefined) add('metric', `Metric: ${filters.metric}`);
  }
  if (filters.service) {
    add(
      'service',
      `${filters.service}${filters.service_status ? ` ${filters.service_status.replaceAll('_', ' ')}` : ''}`,
      'service_status',
    );
  }
  if (filters.charts) add('charts', `Charts: ${filters.charts}`);
  if (filters.user) add('user', `User: ${filters.user}`);
  if (filters.conversation) add('conversation', `Conversation: ${filters.conversation}`);
  if (filters.q) add('q', `Search: ${filters.q}`);
  return chips;
}

/** Keep the same position/name ordering and four-column cap as the read API. */
export function listedScoreColumns(specs: LiveMetricSpec[]): LiveMetricSpec[] {
  const ordered = [...specs].sort(
    (a, b) =>
      a.position - b.position || (a.metric_name < b.metric_name ? -1 : a.metric_name > b.metric_name ? 1 : 0),
  );
  const primary = ordered.find((spec) => spec.is_primary);
  const others = ordered
    .filter((spec) => spec !== primary && (spec.group === 'quality' || spec.group === 'charts'))
    .slice(0, 3);
  return primary ? [primary, ...others] : others;
}
