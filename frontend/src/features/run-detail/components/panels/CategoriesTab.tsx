/** Performance by metadata category: average, items and latency per value; a row filters the table. */
import { useMemo, useState } from 'react';
import { formatLatency, formatNumericValue, formatPercent } from '@/lib/metrics';
import { Chip } from '@/ui';
import { useRunPage } from '../../RunContext';
import { categoryBreakdown, categoryChipKeys } from '../../lib/overviewModel';
import { RateBar } from '../charts/Charts';
import styles from './Panels.module.css';

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
  const [selected, setSelected] = useState<Set<string>>(() => new Set(model.autoCategories));
  const filters = api.view.filters;
  const breakdowns = useMemo(
    () =>
      metric
        ? keys
            .filter((k) => selected.has(k.key))
            .map((k) => categoryBreakdown(api.ctx, rows, k.key, metric, filters.domain))
            .filter((b): b is NonNullable<typeof b> => !!b)
        : [],
    [keys, selected, rows, metric, api.ctx, filters.domain],
  );
  if (!keys.length || !metric) return <p className={styles.note}>No metadata categories to break down.</p>;
  const numeric = model.metricTypes[metric] === 'numeric';
  const fmt = (v: number | null) =>
    v === null ? '—' : numeric ? formatNumericValue(v) : formatPercent(v, 0);
  return (
    <div className={styles.stack}>
      <div className={styles.chipRow} role="group" aria-label="Categories">
        {keys.map(({ key, count }) => (
          <Chip
            key={key}
            count={count}
            isSelected={selected.has(key)}
            onChange={(on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(key);
                else next.delete(key);
                return next;
              })
            }
          >
            {key}
          </Chip>
        ))}
      </div>
      {breakdowns.map((b) => (
        <section key={b.key} className={styles.stack} aria-label={b.key}>
          <h3 className={styles.groupTitle}>
            {b.key}{' '}
            <span className={styles.note}>
              {metric} · overall {fmt(b.overallAverage)}
            </span>
          </h3>
          {b.groups.map((g) => {
            const on =
              filters.categories[b.key]?.length === 1 &&
              filters.categories[b.key]![0]!.toLowerCase() === g.value.toLowerCase();
            return (
              <button
                key={g.value}
                type="button"
                className={styles.cardButton}
                aria-pressed={on}
                data-testid="category-row"
                onClick={() => {
                  const categories = { ...filters.categories };
                  if (on) delete categories[b.key];
                  else categories[b.key] = [g.value];
                  api.setFilters({ categories });
                }}
              >
                <span className={styles.rowHead}>
                  <span className={styles.label}>{g.value}</span>
                  <span className={styles.stat}>{fmt(g.avgScore)}</span>
                </span>
                <RateBar
                  value={numeric ? null : g.avgScore}
                  label={`${g.value}: average ${fmt(g.avgScore)}`}
                />
                <span className={styles.detail}>
                  {g.itemCount} items{g.avgLatency ? ` · ${formatLatency(g.avgLatency)}` : ''}
                  {g.passRate !== null ? ` · ${formatPercent(g.passRate, 0)} pass` : ''}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
