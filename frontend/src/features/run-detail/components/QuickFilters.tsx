/**
 * Quick-filter sidebar body: shown while a scope is active; every control writes the one filter model. It holds only
 * the category and error picks (C154): status is the Items bar's Show, the metric, its threshold, the rules and Clear
 * live in the sticky nav, Sort is the Items bar's, and the scope bar lists the active chips.
 */
import { useMemo } from 'react';
import { Button, IconButton, QuickFilterGroup, Text } from '@/ui';
import { useScope } from '../hooks/useScope';
import { latencyFilterLabel } from '../lib/latencyModel';
import { categoryBreakdown } from '../lib/overviewModel';
import { collectErrors, slotOfKind, type ErrorKind } from '../lib/rowErrors';
import { categoryTogglePatch, errorTogglePatch, selectedCategoryValues } from '../lib/scopeFilters';
import { useRunPage } from '../RunContext';
import styles from './QuickFilters.module.css';

const KINDS: ErrorKind[] = ['Task error', 'Metric error', 'Trace error'];
const MAX_ERRORS = 4;

export function QuickFilters({ onHide, onJump }: { onHide?: () => void; onJump: () => void }) {
  const { api, model } = useRunPage();
  const scope = useScope();
  const { view, selectedMetric: metric } = api;
  const filters = view.filters;
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

  return (
    <div className={styles.root} data-testid="quick-filters">
      {onHide ? (
        <div className={styles.head}>
          <Text as="h2" variant="lg">
            Quick filters
          </Text>
          <IconButton label="Hide quick filters" icon="chevron-right" onPress={onHide} />
        </div>
      ) : null}
      <Text variant="sm" tone="muted">
        {scope.shown.toLocaleString('en-US')} of {scope.total.toLocaleString('en-US')} items
      </Text>
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

      <Button variant="accent" size="sm" onPress={onJump} data-testid="quick-view-items">
        View {scope.shown.toLocaleString('en-US')} items
      </Button>
    </div>
  );
}
