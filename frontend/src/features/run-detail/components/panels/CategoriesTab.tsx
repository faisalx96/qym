/** Categories (round 3 P3): one key at a time, one card of ranked value rows with a bar and a tick at the overall average. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatLatency, formatNumericValue, formatPercent, metricBand } from '@/lib/metrics';
import { applyQueryUpdates } from '@/lib/url-state';
import { Button, Card, SegmentedControl, Select, Text } from '@/ui';
import { useColumnStep } from '../../lib/columnStep';
import {
  barFraction,
  DEFAULT_VISIBLE_VALUES,
  defaultKey as pickDefaultKey,
  insightLine,
  orderValues,
  spreadOf,
  switcherKind,
  visibleValues,
  type CategoryOrder,
} from '../../lib/categoryModel';
import {
  categoryBreakdown,
  categoryChipKeys,
  type CategoryBreakdown,
  type CategoryGroupStat,
} from '../../lib/overviewModel';
import { useRunPage } from '../../RunContext';
import styles from './Categories.module.css';
import panel from './Panels.module.css';

export function CategoriesTab() {
  const { model, items, api } = useRunPage();
  const [params, setParams] = useSearchParams();
  const [rootRef, , width] = useColumnStep<HTMLDivElement>(1100);
  const metric = api.selectedMetric;
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const keys = useMemo(
    () =>
      categoryChipKeys(model.rows, model.allMetadataKeys).filter(({ key }) =>
        rows.some((r) => r.item_metadata?.[key] != null && r.item_metadata[key] !== ''),
      ),
    [model.rows, model.allMetadataKeys, rows],
  );
  // The key with the widest best-to-worst spread opens first, computed once from the whole run so filtering the
  // items by a value never makes the card jump to another key.
  const keyList = keys.map((k) => k.key).join('\u0000');
  const fallbackKey = useMemo(() => {
    const pool = keys.map((k) => k.key);
    if (!metric) return pool[0] ?? null;
    return pickDefaultKey(pool, (k) => spreadOf(categoryBreakdown(api.ctx, model.rows, k, metric, null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyList, metric, model.rows]);
  const asked = params.get('category');
  const selectedKey = asked && keys.some((k) => k.key === asked) ? asked : fallbackKey;
  const [order, setOrder] = useState<CategoryOrder>('worst');
  const filters = api.view.filters;
  const breakdown = useMemo(
    () =>
      metric && selectedKey ? categoryBreakdown(api.ctx, rows, selectedKey, metric, filters.domain) : null,
    [selectedKey, rows, metric, api.ctx, filters.domain],
  );
  if (!keys.length || !metric || !selectedKey) {
    return <p className={panel.note}>No metadata categories to break down.</p>;
  }
  const numeric = model.metricTypes[metric] === 'numeric';
  const direction = model.metricDirections[metric] ?? null;
  const fmt = (v: number | null) =>
    v === null ? '—' : numeric ? formatNumericValue(v) : formatPercent(v, 0);
  const choose = (key: string) =>
    setParams((prev) => applyQueryUpdates(prev, { category: key }), {
      replace: true,
      preventScrollReset: true,
    });
  const items2 = keys.map((k) => ({ key: k.key, label: `${k.key} · ${k.count}` }));
  const overall = breakdown?.overallAverage ?? null;
  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.control}>
        {keys.length > 1 ? (
          switcherKind(keys, width) === 'segmented' ? (
            <SegmentedControl
              label="Category"
              options={items2.map((i) => ({ value: i.key, label: i.label }))}
              value={selectedKey}
              onChange={choose}
            />
          ) : (
            <Select
              label="Category"
              items={items2}
              value={selectedKey}
              onChange={(k) => k && choose(String(k))}
              width={240}
              searchable
            />
          )
        ) : null}
        <Text variant="sm" tone="muted" className={styles.metricNote}>
          Metric: {metric} · overall {fmt(overall)}
        </Text>
      </div>
      {breakdown ? (
        <KeyCard
          b={breakdown}
          order={order}
          onOrder={setOrder}
          numeric={numeric}
          direction={direction}
          metricType={model.metricTypes[metric]}
          fmt={fmt}
        />
      ) : (
        <p className={panel.note}>No scored items for {selectedKey} with the current filters.</p>
      )}
    </div>
  );
}

function KeyCard({
  b,
  order,
  onOrder,
  numeric,
  direction,
  metricType,
  fmt,
}: {
  b: CategoryBreakdown;
  order: CategoryOrder;
  onOrder: (o: CategoryOrder) => void;
  numeric: boolean;
  direction: 'maximize' | 'minimize' | null;
  metricType: string | undefined;
  fmt: (v: number | null) => string;
}) {
  const { api } = useRunPage();
  const filters = api.view.filters;
  const [all, setAll] = useState(false);
  const ordered = useMemo(() => orderValues(b.groups, order, direction), [b.groups, order, direction]);
  const shown = visibleValues(ordered, DEFAULT_VISIBLE_VALUES, all);
  const insight = insightLine(b, direction, fmt, numeric);
  const max = numeric ? Math.max(...b.groups.map((g) => g.avgScore ?? 0), b.overallAverage ?? 0, 1e-9) : null;
  const tick = barFraction(b.overallAverage, max);
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
  return (
    <Card
      as="section"
      aria-label={b.key}
      className={styles.catCard}
      header={
        <div className={styles.head}>
          <span className={styles.title}>
            {b.key} <span className={styles.sub}>{b.groups.length} values</span>
          </span>
          <span className={styles.headRight}>
            <span className={styles.legend}>
              <span className={styles.tickKey} aria-hidden="true" />
              Overall average
            </span>
            <SegmentedControl
              label="Order"
              value={order}
              onChange={onOrder}
              options={[
                { value: 'worst', label: 'Worst first' },
                { value: 'best', label: 'Best first' },
              ]}
            />
          </span>
        </div>
      }
    >
      {insight ? (
        <p className={styles.insight} data-testid="category-insight">
          {insight}
        </p>
      ) : null}
      <div className={styles.cols} aria-hidden="true">
        <span>Value</span>
        <span>Average</span>
        <span className={styles.num}>Items</span>
        <span className={styles.num}>Pass</span>
        <span className={styles.num}>Latency</span>
      </div>
      <div
        role="group"
        aria-label={`Values of ${b.key}, ${order === 'worst' ? 'worst first' : 'best first'}`}
      >
        {shown.map((g) => {
          const on = isOn(g);
          const band =
            g.avgScore !== null && !numeric && direction
              ? metricBand(g.avgScore, metricType, direction)
              : null;
          const title = `${g.value}: ${fmt(g.avgScore)} average, ${g.itemCount} items${
            g.avgLatency ? `, ${formatLatency(g.avgLatency)}` : ''
          }`;
          return (
            <button
              key={g.value}
              type="button"
              className={styles.row}
              aria-pressed={on}
              data-testid="category-row"
              data-value={g.value}
              data-selected={on ? '' : undefined}
              title={title}
              onClick={() => toggle(g)}
            >
              <span className={styles.name} data-part="name" dir="auto">
                {g.value}
              </span>
              <span className={styles.barCell}>
                <span
                  className={styles.track}
                  data-band={band ?? undefined}
                  role="img"
                  aria-label={`average ${fmt(g.avgScore)}, overall average ${fmt(b.overallAverage)}`}
                >
                  <span className={styles.fill} style={{ width: `${barFraction(g.avgScore, max) * 100}%` }} />
                  <span
                    className={styles.tick}
                    data-testid="category-tick"
                    style={{ left: `${tick * 100}%` }}
                  />
                </span>
                <span className={styles.pct} data-band={band ?? undefined}>
                  {fmt(g.avgScore)}
                </span>
              </span>
              <span className={styles.num}>{g.itemCount}</span>
              <span className={styles.num}>{g.passRate === null ? '—' : formatPercent(g.passRate, 0)}</span>
              <span className={styles.num}>{g.avgLatency ? formatLatency(g.avgLatency) : '—'}</span>
            </button>
          );
        })}
      </div>
      {ordered.length > DEFAULT_VISIBLE_VALUES ? (
        <div className={styles.more}>
          <Button size="sm" variant="neutral" onPress={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${ordered.length} values`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
