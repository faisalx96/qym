/**
 * Categories. Round 10 (the first qym's two views): Cards (the default) shows up to three metadata keys at once, each
 * value a small card (average, items, latency, a bar with the overall average tick); checkboxes turn keys on and off.
 * Compare ranks the values of one key in rows. One Sort button orders both (worst or best first). Clicking a value
 * filters the page.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatLatency, formatNumericValue, formatPercent, metricBand } from '@/lib/metrics';
import { applyQueryUpdates } from '@/lib/url-state';
import { Button, Card, Checkbox, Icon, SegmentedControl, Select, Text } from '@/ui';
import { useColumnStep } from '../../lib/columnStep';
import {
  barFraction,
  DEFAULT_VISIBLE_VALUES,
  defaultKey as pickDefaultKey,
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
  // Cards show up to three keys at first (the widest spread first); the checkboxes add or remove keys.
  const [shownKeysState, setShownKeys] = useState<string[] | null>(null);
  const shownKeys = useMemo(() => {
    if (shownKeysState) return shownKeysState;
    const pool = keys.map((k) => k.key);
    const first = fallbackKey ? [fallbackKey, ...pool.filter((k) => k !== fallbackKey)] : pool;
    return first.slice(0, 3);
  }, [shownKeysState, keys, fallbackKey]);
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
    v === null ? '—' : numeric ? formatNumericValue(v) : formatPercent(v, 1);
  const choose = (key: string) =>
    setParams((prev) => applyQueryUpdates(prev, { category: key }), {
      replace: true,
      preventScrollReset: true,
    });
  const items2 = keys.map((k) => ({ key: k.key, label: `${k.key} · ${k.count}` }));
  const overall = breakdown?.overallAverage ?? null;
  const view = params.get('category_view') === 'compare' ? 'compare' : 'cards';
  const setViewParam = (v: 'cards' | 'compare') =>
    setParams((prev) => applyQueryUpdates(prev, { category_view: v === 'cards' ? null : v }), {
      replace: true,
      preventScrollReset: true,
    });
  const sortButton = (
    <Button
      size="sm"
      variant="neutral"
      icon={<Icon name={order === 'worst' ? 'chevron-up' : 'chevron-down'} size={12} />}
      onPress={() => setOrder(order === 'worst' ? 'best' : 'worst')}
      aria-label={`Sort: ${order === 'worst' ? 'worst first' : 'best first'}. Press to reverse.`}
      data-testid="category-sort"
    >
      {order === 'worst' ? 'Worst first' : 'Best first'}
    </Button>
  );
  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.control}>
        <SegmentedControl<'cards' | 'compare'>
          label="Categories view"
          value={view}
          onChange={setViewParam}
          options={[
            { value: 'cards', label: 'Cards' },
            { value: 'compare', label: 'Compare' },
          ]}
        />
        {view === 'compare' && keys.length > 1 ? (
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
              hideLabel
              items={items2}
              value={selectedKey}
              onChange={(k) => k && choose(String(k))}
              width={240}
              searchable
            />
          )
        ) : null}
        {view === 'cards' && keys.length > 1 ? (
          <span className={styles.keyToggles} role="group" aria-label="Categories shown">
            {keys.map((k) => (
              <Checkbox
                key={k.key}
                isSelected={shownKeys.includes(k.key)}
                onChange={(on) =>
                  setShownKeys(on ? [...shownKeys, k.key] : shownKeys.filter((x) => x !== k.key))
                }
              >
                {k.key} <span className={styles.keyCount}>{k.count}</span>
              </Checkbox>
            ))}
          </span>
        ) : null}
        <span className={styles.controlEnd}>
          <Text variant="sm" tone="muted" className={styles.metricNote}>
            {metric} · overall <b className={styles.overall}>{fmt(overall)}</b>
          </Text>
          {sortButton}
        </span>
      </div>
      {view === 'cards' ? (
        <div className={styles.cardsView}>
          {keys
            .filter((k) => shownKeys.includes(k.key))
            .map((k) => (
              <KeyCards
                key={k.key}
                categoryKey={k.key}
                metric={metric}
                order={order}
                numeric={numeric}
                direction={direction}
                metricType={model.metricTypes[metric]}
                fmt={fmt}
              />
            ))}
          {!shownKeys.length ? <p className={panel.note}>Tick a category to show its values.</p> : null}
        </div>
      ) : breakdown ? (
        <KeyCard
          b={breakdown}
          order={order}
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

/** The page filter for one value of a key: on when it is the only value filtered. */
function useValueFilter(key: string) {
  const { api } = useRunPage();
  const filters = api.view.filters;
  const isOn = (value: string) => {
    const current =
      key === 'complexity'
        ? filters.complexity
        : key === 'domain'
          ? filters.domain
          : (filters.categories[key] ?? null);
    return current?.length === 1 && current[0]!.toLowerCase() === value.toLowerCase();
  };
  const toggle = (value: string) => {
    const on = isOn(value);
    if (key === 'complexity') api.setFilters({ complexity: on ? null : [value] });
    else if (key === 'domain')
      api.setFilters({ domain: on ? null : [value], domainMode: 'include', domainOnly: [] });
    else {
      const categories = { ...filters.categories };
      if (on) delete categories[key];
      else categories[key] = [value];
      api.setFilters({ categories });
    }
  };
  return { isOn, toggle };
}

/** Cards view: one key, its values as small cards (the first qym's category cards). */
function KeyCards({
  categoryKey,
  metric,
  order,
  numeric,
  direction,
  metricType,
  fmt,
}: {
  categoryKey: string;
  metric: string;
  order: CategoryOrder;
  numeric: boolean;
  direction: 'maximize' | 'minimize' | null;
  metricType: string | undefined;
  fmt: (v: number | null) => string;
}) {
  const { items, api } = useRunPage();
  const filters = api.view.filters;
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const b = useMemo(
    () => categoryBreakdown(api.ctx, rows, categoryKey, metric, filters.domain),
    [api.ctx, rows, categoryKey, metric, filters.domain],
  );
  const { isOn, toggle } = useValueFilter(categoryKey);
  const ordered = useMemo(() => (b ? orderValues(b.groups, order, direction) : []), [b, order, direction]);
  if (!b || !ordered.length) return null;
  const max = numeric ? Math.max(...b.groups.map((g) => g.avgScore ?? 0), b.overallAverage ?? 0, 1e-9) : null;
  const tick = barFraction(b.overallAverage, max);
  return (
    <section className={styles.keyBlock} aria-label={categoryKey}>
      <h4 className={styles.keyTitle}>
        {categoryKey} <span className={styles.sub}>{b.groups.length} values</span>
      </h4>
      <div className={styles.valueGrid} role="group" aria-label={`Values of ${categoryKey}`}>
        {ordered.map((g) => {
          const on = isOn(g.value);
          const band =
            g.avgScore !== null && !numeric && direction
              ? metricBand(g.avgScore, metricType, direction)
              : null;
          return (
            <button
              key={g.value}
              type="button"
              className={styles.valueCard}
              aria-pressed={on}
              data-selected={on ? '' : undefined}
              data-testid="category-card"
              data-value={g.value}
              onClick={() => toggle(g.value)}
              title={`Filter the items to ${categoryKey} = ${g.value}`}
            >
              <span className={styles.valueName} data-band={band ?? undefined} dir="auto">
                {g.value}
              </span>
              <span className={styles.valueStats}>
                <span>
                  <small>Average</small>
                  <b data-band={band ?? undefined}>{fmt(g.avgScore)}</b>
                </span>
                <span>
                  <small>Items</small>
                  <b>{g.itemCount}</b>
                </span>
                <span>
                  <small>Latency</small>
                  <b>{g.avgLatency ? formatLatency(g.avgLatency) : '—'}</b>
                </span>
              </span>
              <span className={styles.track} data-band={band ?? undefined} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${barFraction(g.avgScore, max) * 100}%` }} />
                <span className={styles.tick} style={{ left: `${tick * 100}%` }} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function KeyCard({
  b,
  order,
  numeric,
  direction,
  metricType,
  fmt,
}: {
  b: CategoryBreakdown;
  order: CategoryOrder;
  numeric: boolean;
  direction: 'maximize' | 'minimize' | null;
  metricType: string | undefined;
  fmt: (v: number | null) => string;
}) {
  const [all, setAll] = useState(false);
  const ordered = useMemo(() => orderValues(b.groups, order, direction), [b.groups, order, direction]);
  const shown = visibleValues(ordered, DEFAULT_VISIBLE_VALUES, all);
  const max = numeric ? Math.max(...b.groups.map((g) => g.avgScore ?? 0), b.overallAverage ?? 0, 1e-9) : null;
  const tick = barFraction(b.overallAverage, max);
  const filter = useValueFilter(b.key);
  const isOn = (g: CategoryGroupStat) => filter.isOn(g.value);
  const toggle = (g: CategoryGroupStat) => filter.toggle(g.value);
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
          </span>
        </div>
      }
    >
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
              <span className={styles.num}>{g.passRate === null ? '—' : formatPercent(g.passRate, 1)}</span>
              <span className={styles.num}>{g.avgLatency ? formatLatency(g.avgLatency) : '—'}</span>
            </button>
          );
        })}
      </div>
      {ordered.length > DEFAULT_VISIBLE_VALUES ? (
        <div className={styles.more}>
          <Button size="sm" variant="neutral" onPress={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show ${ordered.length - DEFAULT_VISIBLE_VALUES} more`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
