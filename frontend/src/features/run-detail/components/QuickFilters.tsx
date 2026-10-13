/** Quick-filter sidebar body: shown while a scope is active; every control writes the one filter model. */
import { useMemo, useState } from 'react';
import { Button, IconButton, QuickFilterGroup, Select, Slider, Text } from '@/ui';
import { useScope } from '../hooks/useScope';
import { latencyFilterLabel } from '../lib/latencyModel';
import { SORT_VALUES, type ItemShow, type SortBy } from '../lib/filterRules';
import { categoryBreakdown } from '../lib/overviewModel';
import { collectErrors, slotOfKind, type ErrorKind } from '../lib/rowErrors';
import { categoryTogglePatch, errorTogglePatch, selectedCategoryValues } from '../lib/scopeFilters';
import { metricHasPassThreshold } from '../lib/runModel';
import { useRunPage } from '../RunContext';
import styles from './QuickFilters.module.css';

const SORT_LABELS: Record<SortBy, string> = {
  index: 'Index',
  score_asc: 'Score ↑',
  score_desc: 'Score ↓',
  latency_asc: 'Latency ↑',
  latency_desc: 'Latency ↓',
};

const STATUS: Array<{ id: ItemShow; label: string }> = [
  { id: 'passed', label: 'Pass' },
  { id: 'failed', label: 'Fail' },
  { id: 'errors', label: 'Errors' },
];
const KINDS: ErrorKind[] = ['Task error', 'Metric error', 'Trace error'];
const MAX_ERRORS = 4;

export function QuickFilters({ onHide, onJump }: { onHide?: () => void; onJump: () => void }) {
  const { api, model } = useRunPage();
  const scope = useScope();
  const { view, selectedMetric: metric } = api;
  const filters = view.filters;
  const hasThreshold = metricHasPassThreshold(model, metric);
  const threshold = metric
    ? Math.round((view.threshold ?? model.defaultThresholds[metric] ?? 0.8) * 100)
    : 80;
  const [thr, setThr] = useState(threshold);
  const [seenThr, setSeenThr] = useState(threshold);
  if (seenThr !== threshold) {
    setSeenThr(threshold);
    setThr(threshold);
  }
  const repeatAggregate = model.isRepeat && !model.viewPass;

  // Counts describe the whole run, so a value stays reachable after it has been chosen.
  const categories = useMemo(
    () =>
      metric
        ? model.autoCategories
            .map((key) => categoryBreakdown(api.ctx, model.rows, key, metric, null))
            .filter((b): b is NonNullable<typeof b> => !!b && b.groups.length > 0)
        : [],
    [api.ctx, model.autoCategories, model.rows, metric],
  );
  const errorGroups = useMemo(() => {
    const buckets = Array.from(collectErrors(model.rows, repeatAggregate).values());
    return KINDS.map((kind) => ({
      kind,
      buckets: buckets
        .filter((b) => b.kind === kind)
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_ERRORS),
    })).filter((g) => g.buckets.length);
  }, [model.rows, repeatAggregate]);

  const status = STATUS.some((s) => s.id === view.show) ? [view.show] : [];
  return (
    <div className={styles.root} data-testid="quick-filters">
      <div className={styles.head}>
        <Text as="h2" variant="lg">
          Quick filters
        </Text>
        {onHide ? <IconButton label="Hide quick filters" icon="chevron-right" onPress={onHide} /> : null}
      </div>
      <Text variant="sm" tone="muted" role="status" data-testid="quick-count">
        {scope.shown.toLocaleString('en-US')} of {scope.total.toLocaleString('en-US')} items
      </Text>
      <Button size="sm" variant="ghost" onPress={scope.clearAll} className={styles.clear}>
        Clear all
      </Button>

      <QuickFilterGroup
        label="Status"
        mode="single"
        options={STATUS}
        selected={status}
        onToggle={(id) => api.setView({ show: view.show === id ? 'all' : (id as ItemShow) })}
      />
      {model.metricNames.length > 1 ? (
        <Select
          label="Metric"
          items={model.metricNames.map((n) => ({ key: n, label: n }))}
          value={metric}
          onChange={(k) =>
            k &&
            api.setView({ metric: String(k) === model.defaultMetric ? null : String(k), threshold: null })
          }
        />
      ) : null}
      {hasThreshold ? (
        <Slider
          label="Pass if at least"
          unit="%"
          minValue={0}
          maxValue={100}
          step={5}
          value={thr}
          onChange={(v) => setThr(v as number)}
          onChangeEnd={(v) => api.setView({ threshold: (v as number) / 100 })}
        />
      ) : null}

      {categories.map((b) => (
        <QuickFilterGroup
          key={b.key}
          label={`Category ${b.key}`}
          mode="single"
          options={b.groups.map((g) => ({ id: g.value, label: g.value, count: g.itemCount }))}
          selected={selectedCategoryValues(filters, b.key)}
          onToggle={(value) => api.setFilters(categoryTogglePatch(filters, b.key, value))}
        />
      ))}
      {errorGroups.map((g) => (
        <QuickFilterGroup
          key={g.kind}
          label={`${g.kind}s`}
          mode="single"
          options={g.buckets.map((b) => ({
            id: b.label,
            label: b.label.length > 28 ? b.label.slice(0, 27) + '…' : b.label,
            count: b.count,
            tone: 'danger' as const,
          }))}
          selected={filters.errors[slotOfKind(g.kind)] ? [filters.errors[slotOfKind(g.kind)]!.label] : []}
          onToggle={(label) => {
            const bucket = g.buckets.find((b) => b.label === label);
            if (bucket) api.setFilters(errorTogglePatch(filters, bucket));
          }}
        />
      ))}
      {filters.latency || filters.repeat ? (
        <QuickFilterGroup
          label="Ranges"
          mode="multi"
          options={[
            ...(filters.latency ? [{ id: 'latency', label: latencyFilterLabel(filters.latency) }] : []),
            ...(filters.repeat
              ? [{ id: 'repeat', label: `${filters.repeat.bucket} of ${filters.repeat.samples} passes` }]
              : []),
          ]}
          selected={[...(filters.latency ? ['latency'] : []), ...(filters.repeat ? ['repeat'] : [])]}
          onToggle={(id) => api.setFilters(id === 'latency' ? { latency: null } : { repeat: null })}
        />
      ) : null}

      <Select
        label="Sort by"
        items={(['index', ...SORT_VALUES] as SortBy[]).map((v) => ({ key: v, label: SORT_LABELS[v] }))}
        value={view.sort}
        onChange={(k) => k && api.setView({ sort: String(k) as SortBy })}
      />
      <Button variant="accent" size="sm" onPress={onJump} data-testid="quick-view-items">
        View {scope.shown.toLocaleString('en-US')} items
      </Button>
    </div>
  );
}
