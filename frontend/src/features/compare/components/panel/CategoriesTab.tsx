/** Performance by category: one table per metadata key, a row per value, a column per run (brief 05 J4). */
import { useMemo } from 'react';
import { useSearchParamsState } from '@/lib/url-state';
import { formatLatency, formatMetricValue } from '@/lib/metrics';
import { Chip, SegmentedControl, Tag, Text } from '@/ui';
import { AUTO_CATEGORIES, categoryDelta, categoryGroups, categoryKeys } from '../../lib/breakdown';
import { useCompare } from '../../CompareContext';
import { columnName } from '../../lib/columnName';
import { DeltaTag } from '../common';
import { CompareSection } from '../CompareSection';
import { scrollToSection, sectionDomId } from '../sectionIds';
import { RunTag } from '../RunTag';
import { CategoryCards } from './CategoryCards';
import { ScrollRegion } from '../ScrollRegion';
import styles from './Panel.module.css';

export function CategoriesSection() {
  const { model, columns, baseline, items, ctx, metric, c } = useCompare();
  const ids = useMemo(() => items.map((i) => i.itemId), [items]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const keys = useMemo(() => categoryKeys(model, idSet), [model, idSet]);
  const type = model.types[metric] ?? 'score';
  const f = c.view.filters;
  // First three keys until the user picks (compare.html auto-selects 3).
  const chosen = useMemo(() => keys.slice(0, AUTO_CATEGORIES).map((k) => k.key), [keys]);
  // The chosen keys live in the URL (`catKeys`, one value `-` for none), so a link restores the breakdowns shown.
  const { params, replaceUrlQuery } = useSearchParamsState();
  const picked = params.has('catKeys') ? params.getAll('catKeys').filter((k) => k !== '-') : null;
  const setPicked = (next: string[]) => replaceUrlQuery({ catKeys: next.length ? next : ['-'] });
  const selected = useMemo(() => {
    const filtered = Object.keys(f.categories);
    if (f.complexity) filtered.push('complexity');
    if (f.domain) filtered.push('domain');
    return Array.from(new Set([...(picked ?? chosen), ...filtered])).filter((k) =>
      keys.some((x) => x.key === k),
    );
  }, [chosen, picked, f, keys]);
  const baseIdx = columns.indexOf(baseline);
  const groups = useMemo(
    () => Object.fromEntries(selected.map((k) => [k, categoryGroups(model, k, columns, ids, ctx, f.domain)])),
    [model, selected, columns, ids, ctx, f.domain],
  );
  const setFilter = (key: string, value: string) => {
    const cur =
      key === 'complexity' ? f.complexity : key === 'domain' ? f.domain : (f.categories[key] ?? null);
    const next = cur && cur.length === 1 && cur[0] === value ? null : [value];
    if (next) scrollToSection('items');
    if (key === 'complexity') c.setView({ filters: { ...f, complexity: next } });
    else if (key === 'domain')
      c.setView({ filters: { ...f, domain: next, domainMode: 'include', domainOnly: [] } });
    else {
      const cats = { ...f.categories };
      if (next) cats[key] = next;
      else delete cats[key];
      c.setView({ filters: { ...f, categories: cats } });
    }
  };
  const active = (key: string, value: string) => {
    const cur = key === 'complexity' ? f.complexity : key === 'domain' ? f.domain : f.categories[key];
    return !!cur && cur.includes(value);
  };
  const aside = keys.length ? (
    <>
      <div className={styles.chipBar} data-part="category-chip-bar" role="group" aria-label="Metadata keys">
        <span className={styles.chipBarLabel}>Categories</span>
        {keys.map(({ key, count }) => (
          <Chip
            key={key}
            count={count}
            isSelected={selected.includes(key)}
            onChange={(on) => setPicked(on ? [...selected, key] : selected.filter((k) => k !== key))}
          >
            {key}
          </Chip>
        ))}
      </div>
      <CategoryViewToggle />
    </>
  ) : undefined;
  return (
    <CompareSection
      id={sectionDomId('categories')}
      part="section-categories"
      title="Performance by category"
      description="Average per metadata value and run, against the baseline tick. Press a card to filter the items."
      aside={aside}
    >
      {!keys.length ? (
        <Text variant="sm" tone="muted">
          No item metadata to break the results down by.
        </Text>
      ) : (
    <div className={styles.stack}>
      {selected.map((key, rank) => {
        const list = groups[key] ?? [];
        if (!list.length) return null;
        return (
          <section key={key} aria-label={`By ${key}`}>
            <h3 className={styles.catKey}>
              <span aria-hidden="true">◆</span> {key} <Tag kind="data">{metric}</Tag>
            </h3>
            {c.view.catView === 'cards' ? (
              <CategoryCards
                keyName={key}
                groups={list}
                rank={rank}
                active={(value) => active(key, value)}
                onPick={(value) => setFilter(key, value)}
              />
            ) : (
              <ScrollRegion className={styles.scroll} label={`${key} breakdown`}>
                <table className={`${styles.table} ${styles.fixed}`}>
                  <thead>
                    <tr>
                      <th scope="col">Value</th>
                      {columns.map((col) => (
                        <th scope="col" key={col.key} title={col.title}>
                          <RunTag index={col.runIdxs[0] ?? 0} name={columnName(model, col)} compact />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((g) => (
                      <tr key={g.value} data-active={active(key, g.value) || undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className={styles.rowButton}
                            aria-pressed={active(key, g.value)}
                            onClick={() => setFilter(key, g.value)}
                          >
                            {g.value} <span className={styles.count}>{g.itemIds.size}</span>
                          </button>
                        </th>
                        {columns.map((col, i) => {
                          const cell = g.cells[i]!;
                          const base = g.cells[baseIdx];
                          const d =
                            i !== baseIdx && base && cell.score !== null && base.score !== null
                              ? categoryDelta(model, col, baseline, ctx, cell, base)
                              : null;
                          return (
                            <td key={col.key}>
                              <div className={styles.cell}>
                                <span className={styles.value}>
                                  {cell.score === null ? '—' : formatMetricValue(cell.score, type, 0)}
                                </span>
                                <span className={styles.sub}>
                                  {cell.latency === null ? '' : formatLatency(cell.latency)}
                                </span>
                                {d ? <DeltaTag stats={d} type={type} metric={metric} /> : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </section>
        );
      })}
    </div>
      )}
    </CompareSection>
  );
}

/** Cards | Table switch for the Categories section header (`catView=table` in the URL). */
export function CategoryViewToggle() {
  const { model, items, c } = useCompare();
  const idSet = useMemo(() => new Set(items.map((i) => i.itemId)), [items]);
  const keys = useMemo(() => categoryKeys(model, idSet), [model, idSet]);
  if (!keys.length) return null;
  return (
    <SegmentedControl<'cards' | 'table'>
      label="Categories view"
      value={c.view.catView}
      onChange={(v) => c.setView({ catView: v })}
      options={[
        { value: 'cards', label: 'Cards' },
        { value: 'table', label: 'Table' },
      ]}
    />
  );
}
