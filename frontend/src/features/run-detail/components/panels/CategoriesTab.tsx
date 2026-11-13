/**
 * Categories. Round 10 (the first qym's two views): Cards (the default) shows up to three metadata keys at once, each
 * value a small card (average, items, latency, a bar with the overall average tick); toggle chips turn keys on and
 * off (cv5 M1).
 * Compare ranks the values of one key in rows. Both views list the best value first (cv4 C2-5: no sort control).
 * Clicking a value filters the page.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatLatency, formatNumericValue, formatPercent, metricBand } from '@/lib/metrics';
import { applyQueryUpdates } from '@/lib/url-state';
import { Button, Card, CardTitle, CountTile, EmptyState, SegmentedControl, Select, ToggleChips } from '@/ui';
import { useColumnStep } from '../../lib/columnStep';
import {
  barFraction,
  DEFAULT_VISIBLE_VALUES,
  defaultKey as pickDefaultKey,
  orderValues,
  spreadOf,
  switcherKind,
  visibleValues,
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
  // Cards show up to three keys at first (the widest spread first); the toggle chips add or remove keys.
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
    return <EmptyState compact title="No metadata categories to break down" />;
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
  // cv4 C2-4: the number of values of a key is the shared count badge, not plain text
  const items2 = keys.map((k) => ({ key: k.key, label: k.key, count: k.count }));
  const keyLabel = (k: { key: string; count: number }) => (
    <>
      {k.key}
      <CountTile>{k.count}</CountTile>
    </>
  );
  const view = params.get('category_view') === 'compare' ? 'compare' : 'cards';
  const setViewParam = (v: 'cards' | 'compare') =>
    setParams((prev) => applyQueryUpdates(prev, { category_view: v === 'cards' ? null : v }), {
      replace: true,
      preventScrollReset: true,
    });
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
              options={items2.map((i) => ({ value: i.key, label: keyLabel(i) }))}
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
              renderItem={keyLabel}
              renderValue={(i) => i.label}
              width={240}
              searchable
            />
          )
        ) : null}
        {view === 'cards' && keys.length > 1 ? (
          // cv5 M1: the keys are on/off chips, all visible, each with its number of values; one stays on
          <ToggleChips
            aria-label="Categories shown"
            options={keys.map((k) => ({ value: k.key, label: k.key, count: k.count }))}
            value={shownKeys}
            onChange={setShownKeys}
            min={1}
          />
        ) : null}
        {view === 'cards' && shownKeys.length ? (
          // cv4 Y4: the key sits right after the field toggles, next to what it explains
          <span className={styles.legend}>
            <span className={styles.tickKey} aria-hidden="true" />
            Overall average
          </span>
        ) : null}
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
                numeric={numeric}
                direction={direction}
                metricType={model.metricTypes[metric]}
                fmt={fmt}
              />
            ))}
          {!shownKeys.length ? <p className={panel.note}>Turn on a category to show its values.</p> : null}
        </div>
      ) : breakdown ? (
        <KeyCard
          b={breakdown}
          numeric={numeric}
          direction={direction}
          metricType={model.metricTypes[metric]}
          fmt={fmt}
        />
      ) : (
        <EmptyState compact title={`No scored items for ${selectedKey} with these filters`} />
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
  numeric,
  direction,
  metricType,
  fmt,
}: {
  categoryKey: string;
  metric: string;
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
  const ordered = useMemo(() => (b ? orderValues(b.groups, direction) : []), [b, direction]);
  if (!b || !ordered.length) return null;
  const max = numeric ? Math.max(...b.groups.map((g) => g.avgScore ?? 0), b.overallAverage ?? 0, 1e-9) : null;
  const tick = barFraction(b.overallAverage, max);
  return (
    <section className={styles.keyBlock} aria-label={categoryKey}>
      <CardTitle as="h4" title={categoryKey} />
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
  numeric,
  direction,
  metricType,
  fmt,
}: {
  b: CategoryBreakdown;
  numeric: boolean;
  direction: 'maximize' | 'minimize' | null;
  metricType: string | undefined;
  fmt: (v: number | null) => string;
}) {
  const [all, setAll] = useState(false);
  const ordered = useMemo(() => orderValues(b.groups, direction), [b.groups, direction]);
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
        <CardTitle
          as="h4"
          title={b.key}
          aside={
            <span className={styles.legend}>
              <span className={styles.tickKey} aria-hidden="true" />
              Overall average
            </span>
          }
        />
      }
    >
      <div className={styles.cols} aria-hidden="true">
        <span>Value</span>
        <span>Average</span>
        <span className={styles.num}>Items</span>
        <span className={styles.num}>Pass</span>
        <span className={styles.num}>Latency</span>
      </div>
      <div role="group" aria-label={`Values of ${b.key}, best first`}>
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
