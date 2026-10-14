/** Performance by metadata category: one key at a time as a ranked table (worst first); a row filters the items. */
import { useMemo, useState } from 'react';
import { formatLatency, formatNumericValue, formatPercent } from '@/lib/metrics';
import { Button, Chip, DataTable, Disclosure, IconButton, ScoreBar, Select, type Column } from '@/ui';
import { useRunPage } from '../../RunContext';
import {
  categoryBreakdown,
  categoryChipKeys,
  categoryInsight,
  categorySpread,
  sortCategoryGroups,
  type CategoryBreakdown,
  type CategoryGroupStat,
  type CategorySort,
} from '../../lib/overviewModel';
import styles from './Panels.module.css';

const SORTS: Array<{ key: CategorySort; label: string }> = [
  { key: 'worst', label: 'Worst first' },
  { key: 'best', label: 'Best first' },
  { key: 'items', label: 'Most items' },
  { key: 'name', label: 'Name' },
];
const COLLAPSED_ROWS = 8;
const VISIBLE_KEYS = 8;

export function CategoriesTab() {
  const { model, items, api } = useRunPage();
  const metric = api.selectedMetric;
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const keys = useMemo(
    () =>
      categoryChipKeys(model.rows, model.allMetadataKeys).filter(({ key }) =>
        rows.some((r) => r.item_metadata?.[key] != null && r.item_metadata[key] !== ''),
      ),
    [model.rows, model.allMetadataKeys, rows],
  );
  const filters = api.view.filters;
  // the key with the widest best-to-worst spread opens first (it answers "where is the model weak?")
  const defaultKey = useMemo(() => {
    if (!metric) return keys[0]?.key ?? null;
    let best: { key: string; spread: number } | null = null;
    for (const k of keys) {
      const b = categoryBreakdown(api.ctx, rows, k.key, metric, filters.domain);
      const spread = b ? categorySpread(b) : 0;
      if (!best || spread > best.spread) best = { key: k.key, spread };
    }
    return best?.key ?? keys[0]?.key ?? null;
  }, [keys, rows, metric, api.ctx, filters.domain]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [sort, setSort] = useState<CategorySort>('worst');
  const selected = (chosen ?? (defaultKey ? [defaultKey] : [])).filter((k) => keys.some((x) => x.key === k));
  const selectedKey = selected.join('\u0000');
  const breakdowns = useMemo(
    () =>
      metric
        ? selected
            .map((k) => categoryBreakdown(api.ctx, rows, k, metric, filters.domain))
            .filter((b): b is NonNullable<typeof b> => !!b)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey, rows, metric, api.ctx, filters.domain],
  );
  if (!keys.length || !metric) return <p className={styles.note}>No metadata categories to break down.</p>;
  const numeric = model.metricTypes[metric] === 'numeric';
  const direction = model.metricDirections[metric] ?? null;
  const fmt = (v: number | null) =>
    v === null ? '—' : numeric ? formatNumericValue(v) : formatPercent(v, 0);
  const only = (key: string) => setChosen([key]);
  const add = (key: string) => setChosen([...selected.filter((k) => k !== key), key]);
  const drop = (key: string) => setChosen(selected.filter((k) => k !== key));
  const chip = ({ key, count }: { key: string; count: number }) => {
    const on = selected.includes(key);
    return (
      <span key={key} className={styles.keyChip}>
        <Chip
          count={count}
          isSelected={on}
          onPress={(e) => {
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
              if (on) {
                if (selected.length > 1) drop(key);
              } else add(key);
            } else only(key);
          }}
          onRemove={on && selected.length > 1 ? () => drop(key) : undefined}
          removeLabel={`Remove ${key}`}
        >
          {key}
        </Chip>
        {!on ? <IconButton label={`Add ${key}`} icon="plus" onPress={() => add(key)} /> : null}
      </span>
    );
  };
  const head = keys.slice(0, VISIBLE_KEYS);
  const rest = keys.slice(VISIBLE_KEYS);
  return (
    <div className={styles.stack}>
      <div className={styles.chipRow} role="group" aria-label="Categories">
        {head.map(chip)}
      </div>
      {rest.length ? (
        <Disclosure title="More keys" summary={`${rest.length} more`}>
          <div className={styles.chipRow} role="group" aria-label="More categories">
            {rest.map(chip)}
          </div>
        </Disclosure>
      ) : null}
      <div className={styles.controls}>
        <Select
          label="Sort"
          items={SORTS.map((s) => ({ key: s.key, label: s.label }))}
          value={sort}
          onChange={(k) => k && setSort(k as CategorySort)}
          width="16ch"
        />
      </div>
      {breakdowns.map((b) => (
        <KeyTable
          key={b.key}
          b={b}
          metric={metric}
          sort={sort}
          numeric={numeric}
          direction={direction}
          fmt={fmt}
        />
      ))}
    </div>
  );
}

function KeyTable({
  b,
  metric,
  sort,
  numeric,
  direction,
  fmt,
}: {
  b: CategoryBreakdown;
  metric: string;
  sort: CategorySort;
  numeric: boolean;
  direction: 'maximize' | 'minimize' | null;
  fmt: (v: number | null) => string;
}) {
  const { model, api } = useRunPage();
  const filters = api.view.filters;
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => sortCategoryGroups(b.groups, sort, direction), [b.groups, sort, direction]);
  const shown = all ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const insight = categoryInsight(b, direction, fmt, numeric);
  const maxAvg = numeric
    ? Math.max(...b.groups.map((g) => g.avgScore ?? 0), b.overallAverage ?? 0, 1e-9)
    : undefined;
  const isOn = (g: CategoryGroupStat) => {
    const current =
      b.key === 'complexity'
        ? filters.complexity
        : b.key === 'domain'
          ? filters.domain
          : (filters.categories[b.key] ?? null);
    return current?.length === 1 && current[0]!.toLowerCase() === g.value.toLowerCase();
  };
  const toggle = (g: CategoryGroupStat) => {
    const on = isOn(g);
    if (b.key === 'complexity') api.setFilters({ complexity: on ? null : [g.value] });
    else if (b.key === 'domain')
      api.setFilters({ domain: on ? null : [g.value], domainMode: 'include', domainOnly: [] });
    else {
      const categories = { ...filters.categories };
      if (on) delete categories[b.key];
      else categories[b.key] = [g.value];
      api.setFilters({ categories });
    }
  };
  const columns: Column<CategoryGroupStat>[] = [
    {
      id: 'value',
      header: b.key,
      label: b.key,
      accessor: (g) => g.value,
      flex: true,
      priority: 1,
      cardTitle: true,
      minWidth: 140,
    },
    {
      id: 'average',
      header: 'Average',
      label: 'Average',
      type: 'score',
      width: 240,
      priority: 2,
      accessor: (g) => g.avgScore,
      cell: (g) => (
        <ScoreBar
          value={g.avgScore}
          type={model.metricTypes[metric]}
          direction={direction}
          max={maxAvg}
          text={g.avgScore === null ? undefined : fmt(g.avgScore)}
          marker={b.overallAverage}
          width={140}
          markerLabel={`Overall average ${fmt(b.overallAverage)}`}
        />
      ),
    },
    {
      id: 'items',
      header: 'Items',
      label: 'Items',
      type: 'number',
      width: 80,
      priority: 2,
      accessor: (g) => g.itemCount,
    },
    {
      id: 'pass',
      header: 'Pass',
      label: 'Pass',
      type: 'number',
      width: 80,
      priority: 2,
      accessor: (g) => g.passRate,
      cell: (g) => (g.passRate === null ? '—' : formatPercent(g.passRate, 0)),
    },
    {
      id: 'latency',
      header: 'Latency',
      label: 'Latency',
      type: 'number',
      width: 100,
      priority: 2,
      accessor: (g) => g.avgLatency,
      cell: (g) => (g.avgLatency ? formatLatency(g.avgLatency) : '—'),
    },
  ];
  return (
    <section className={styles.stack} aria-label={b.key}>
      <h3 className={styles.groupTitle}>
        {b.key}{' '}
        <span className={styles.note}>
          {metric} · overall {fmt(b.overallAverage)}
        </span>
      </h3>
      {insight ? (
        <p className={styles.verdict} data-testid="category-insight">
          {insight}
        </p>
      ) : null}
      <DataTable<CategoryGroupStat>
        aria-label={`${b.key} breakdown`}
        columns={columns}
        rows={shown}
        rowKey={(g) => g.value}
        density="compact"
        densityLocked
        columnMenu={false}
        zebra={false}
        variant="embedded"
        stickyHeader={false}
        onRowOpen={toggle}
        rowProps={(g) => {
          const on = isOn(g);
          return {
            'data-testid': 'category-row',
            'data-value': g.value,
            'aria-selected': String(on),
            'data-selected': on ? '' : undefined,
          };
        }}
      />
      {sorted.length > COLLAPSED_ROWS ? (
        <div>
          <Button size="sm" variant="neutral" onPress={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${sorted.length} values`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
