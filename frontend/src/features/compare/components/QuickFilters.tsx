/** The quick-filter sidebar: the same filter model as the toolbar, one click each (brief 5.6). */
import { useMemo } from 'react';
import { errorBucketKey, splitErrorLabel, type ErrorSlot } from '@/features/run-detail/lib/rowErrors';
import {
  Button,
  IconButton,
  QuickFilterGroup,
  ScopeChips,
  SearchField,
  Select,
  Text,
  type QuickFilterOption,
} from '@/ui';
import { letterOf, useCompare } from '../CompareContext';
import { useColumnStats, useColumns } from '../hooks/useColumnStats';
import { useScope } from '../hooks/useScope';
import type { DeltaKind } from '../lib/baseline';
import { AUTO_CATEGORIES, categoryGroups, categoryKeys, errorDistribution } from '../lib/breakdown';
import { SORT_VALUES, type SortBy } from '../lib/filters';
import { categoryIsOn, toggleCategory } from '../lib/scope';
import styles from './QuickFilters.module.css';

const SHOW: QuickFilterOption[] = [
  { id: 'different', label: 'Different outputs' },
  { id: 'errors', label: 'With errors', tone: 'danger' },
  { id: 'all_correct', label: 'All runs correct', tone: 'success' },
  { id: 'all_wrong', label: 'No run correct', tone: 'danger' },
  { id: 'partially_correct', label: 'Partially correct' },
  { id: 'rarely_solved', label: 'Rarely solved' },
  { id: 'unique_solve', label: 'Uniquely solved' },
];
const SORT: Record<SortBy, string> = {
  index: 'Item order',
  score_asc: 'Score, low to high',
  score_desc: 'Score, high to low',
  latency_asc: 'Latency, fast to slow',
  latency_desc: 'Latency, slow to fast',
  change_desc: 'Biggest change vs baseline',
};
const SLOT: Record<string, ErrorSlot> = {
  'Task error': 'task',
  'Metric error': 'metric',
  'Trace error': 'trace',
  'Analysis error': 'analysis',
};

export function QuickFilters({ onHide, onViewItems }: { onHide?: () => void; onViewItems: () => void }) {
  const { c, model, ctx, columns, baseline, items, metric } = useCompare();
  const scope = useScope();
  const info = useColumns(model, c.view);
  const stats = useColumnStats(model, info ?? { columns, baseline }, ctx);
  const f = c.view.filters;
  const dir = ctx.direction;
  const ids = useMemo(() => items.map((i) => i.itemId), [items]);
  const idSet = useMemo(() => new Set(ids), [ids]);

  const changeOptions = columns
    .filter((col) => col.key !== baseline.key)
    .flatMap((col): QuickFilterOption[] => {
      const s = stats.get(col.key);
      if (!s) return [];
      const l = letterOf(col.runIdxs[0] ?? 0);
      return [
        { id: `${col.key}|improved`, label: `${l} improved`, count: s.counts.improved, tone: 'success' },
        { id: `${col.key}|regressed`, label: `${l} regressed`, count: s.counts.regressed, tone: 'danger' },
      ];
    });
  const activeChange =
    f.baseline && f.baseline.metric === metric ? `${f.baseline.columnKey}|${f.baseline.kind}` : null;
  const toggleChange = (id: string) => {
    const [columnKey, kind] = id.split('|') as [string, DeltaKind];
    c.setView({
      filters: {
        ...f,
        baseline: id === activeChange ? null : { metric, columnKey, baselineKey: baseline.key, kind },
      },
    });
  };

  const winnerOptions: QuickFilterOption[] = dir
    ? [
        ...model.runs.map((r, i) => ({ id: `win_${i}`, label: `${letterOf(i)} won`, title: r.label })),
        ...model.runs.map((r, i) => ({ id: `only_${i}`, label: `Only ${letterOf(i)}`, title: r.label })),
        { id: 'tie', label: 'Ties' },
      ].map(({ id, label }) => ({ id, label }))
    : [];

  const keys = useMemo(() => categoryKeys(model, idSet).slice(0, AUTO_CATEGORIES), [model, idSet]);
  const categories = useMemo(
    () =>
      keys.map(({ key }) => ({
        key,
        options: categoryGroups(model, key, columns, ids, ctx, f.domain)
          .filter((g) => g.value)
          .slice(0, 12)
          .map((g) => ({ id: g.value, label: g.value, count: g.itemIds.size })),
      })),
    [keys, model, columns, ids, ctx, f.domain],
  );

  const errors = useMemo(() => errorDistribution(model, columns, items).slice(0, 8), [model, columns, items]);
  const errorOptions: QuickFilterOption[] = errors.map((e) => ({
    id: `${e.kind}|${e.label}`,
    label: `${e.kind.replace(' error', '')}: ${splitErrorLabel(e.label).title}`,
    count: e.count,
    tone: 'danger',
  }));
  const activeErrors = (Object.values(f.errors) as Array<{ kind: string; label: string }>).map(
    (e) => `${e.kind}|${e.label}`,
  );
  const toggleError = (id: string) => {
    const [kind, ...rest] = id.split('|');
    const label = rest.join('|');
    const slot = SLOT[kind!] ?? 'trace';
    const cur = f.errors[slot];
    const same = cur && errorBucketKey(cur.kind, cur.label) === errorBucketKey(kind!, label);
    const next = { ...f.errors };
    if (same) delete next[slot];
    else next[slot] = { kind: kind!, label };
    c.setView({ filters: { ...f, errors: next } });
  };

  return (
    <div className={styles.body} data-testid="quick-filters">
      {onHide ? (
        <div className={styles.head}>
          <Text variant="md" weight={650} tone="primary">
            Quick filters
          </Text>
          <IconButton label="Hide quick filters" icon="close" onPress={onHide} />
        </div>
      ) : null}
      <Text variant="sm" tone="muted">
        {scope.shown.toLocaleString('en-US')} of {scope.total.toLocaleString('en-US')} items
      </Text>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onPress={scope.clearAll}>
          Clear all
        </Button>
        <Button size="sm" variant="neutral" onPress={onViewItems}>
          View {scope.shown.toLocaleString('en-US')} items
        </Button>
      </div>
      <div className={styles.active} role="group" aria-label="Active filters">
        <Text variant="sm" tone="muted" weight={650}>
          ACTIVE
        </Text>
        <div className={styles.chips}>
          <ScopeChips
            chips={scope.chips.map((chip) => ({
              key: chip.key,
              label: chip.label,
              onClear: () => scope.clearChip(chip),
            }))}
            maxChips={20}
          />
        </div>
      </div>
      <SearchField
        label="Filter by text"
        hideLabel
        placeholder="Search id, input, outputs…"
        value={c.view.q}
        onChange={(q) => c.setView({ q })}
        onClear={() => c.setView({ q: '' })}
      />
      <QuickFilterGroup
        label="Show"
        mode="single"
        options={SHOW}
        selected={SHOW.some((o) => o.id === c.view.show) ? [c.view.show] : []}
        onToggle={(id) => c.setView({ show: c.view.show === id ? 'all' : id })}
      />
      <QuickFilterGroup
        label="Winner"
        mode="single"
        options={winnerOptions}
        selected={c.view.winner === 'any' ? [] : [c.view.winner]}
        onToggle={(id) => c.setView({ winner: c.view.winner === id ? 'any' : id })}
      />
      <QuickFilterGroup
        label={`Change vs baseline · ${metric}`}
        mode="single"
        options={changeOptions}
        selected={activeChange ? [activeChange] : []}
        onToggle={toggleChange}
      />
      {categories.map((cat) => (
        <QuickFilterGroup
          key={cat.key}
          label={cat.key}
          mode="multi"
          options={cat.options}
          selected={cat.options.filter((o) => categoryIsOn(f, cat.key, o.id)).map((o) => o.id)}
          onToggle={(id) => c.setView({ filters: toggleCategory(f, cat.key, id) })}
        />
      ))}
      <QuickFilterGroup
        label="Errors"
        mode="multi"
        options={errorOptions}
        selected={activeErrors}
        onToggle={toggleError}
      />
      <Select
        label="Order by"
        value={c.view.sort}
        onChange={(k) => k && c.setView({ sort: String(k) as SortBy })}
        items={(['index', ...SORT_VALUES] as SortBy[]).map((s) => ({ key: s, label: SORT[s] }))}
      />
    </div>
  );
}
