/** Sweep: cohort A vs B with k executions each (brief 05 J2) - verdict, five stats with noise bands, metadata breakdown, outcomes, item table. */
import { useMemo, useState } from 'react';
import { metricDirectionLabel } from '@/lib/metrics';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  HelpMarker,
  MultiSelect,
  SearchField,
  Select,
  Tag,
  Text,
} from '@/ui';
import { useSearchParamsState } from '@/lib/url-state';
import { getMetadataCategoryValues } from '@/features/run-detail/lib/rowMeta';
import { useCompare } from '../../CompareContext';
import {
  DEFAULT_SWEEP_FILTERS,
  breakdownDeltaGood,
  computeGroupedComparison,
  defaultSweepSort,
  filterSweepItems,
  reverseSweepItem,
  sweepKeySupportsOnly,
  sweepMetadataKeys,
  sweepMetadataValues,
  sweepOutcomeOf,
  summarizeSweepItems,
  type SweepFilters,
  type SweepItem,
  type SweepMove,
  type SweepOutcome,
} from '../../lib/cohort';
import type { NoiseStat } from '../../lib/noise';
import { ItemDetail } from '../items/ItemDetail';
import { ScrollRegion } from '../ScrollRegion';
import styles from './SweepView.module.css';

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`;
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`;

function useSweepFilters(): [
  SweepFilters,
  boolean,
  (patch: Partial<SweepFilters> & { reverse?: boolean }) => void,
] {
  const { params, replaceUrlQuery } = useSearchParamsState();
  const f: SweepFilters = {
    move: (['improved', 'regressed', 'unchanged'].includes(params.get('sweepMove') ?? '')
      ? params.get('sweepMove')
      : 'all') as SweepMove,
    outcome: (['left_sweeps_right', 'right_sweeps_left', 'both_pass', 'both_fail', 'mixed'].includes(
      params.get('sweepOutcome') ?? '',
    )
      ? params.get('sweepOutcome')
      : 'all') as SweepOutcome,
    q: params.get('sweepQ') ?? '',
    key: params.get('sweepKey') ?? 'all',
    values: params.has('sweepValues') ? params.getAll('sweepValues').filter(Boolean) : null,
    mode: params.get('sweepMode') === 'exclude' ? 'exclude' : 'include',
    only: params.getAll('sweepOnly'),
  };
  const reverse = params.get('sweepReverse') === '1';
  const set = (patch: Partial<SweepFilters> & { reverse?: boolean }) => {
    const next = { ...f, ...patch };
    replaceUrlQuery({
      sweepMove: next.move === 'all' ? null : next.move,
      sweepOutcome: next.outcome === 'all' ? null : next.outcome,
      sweepQ: next.q || null,
      sweepKey: next.key === 'all' ? null : next.key,
      sweepValues: next.values === null ? null : next.values.length ? next.values : [''],
      sweepMode: next.mode === 'exclude' ? 'exclude' : null,
      sweepOnly: next.only,
      sweepReverse: (patch.reverse ?? reverse) ? '1' : null,
    });
  };
  return [f, reverse, set];
}

function StatCard({
  label,
  from,
  to,
  delta,
  noise,
  help,
}: {
  label: React.ReactNode;
  from: number | null;
  to: number | null;
  delta: number | null;
  noise: NoiseStat | null;
  help?: string;
}) {
  const verdict = noise?.verdict ?? (delta === null ? 'within_noise' : 'within_noise');
  const tone = verdict === 'improved' ? 'success' : verdict === 'regressed' ? 'danger' : undefined;
  const word = verdict === 'improved' ? 'improved' : verdict === 'regressed' ? 'regressed' : 'within noise';
  return (
    <div className={styles.stat} data-verdict={verdict}>
      <div className={styles.statLabel}>
        {label}
        {help ? (
          <HelpMarker label={`About ${typeof label === 'string' ? label : 'this metric'}`}>{help}</HelpMarker>
        ) : null}
      </div>
      <div className={styles.statValue}>
        <span>{pct(from)}</span> <span aria-hidden>{'→'}</span> <strong>{pct(to)}</strong>
      </div>
      {delta !== null ? (
        <div className={styles.statDelta}>
          <Tag kind="data" tone={tone}>
            {verdict === 'improved' ? '▲' : verdict === 'regressed' ? '▼' : '≈'} {signed(delta)}
            <span className={styles.srOnly}> ({word})</span>
          </Tag>
          {noise ? (
            <span className={styles.noise} title={`95% noise band, p=${noise.pValue.toFixed(3)}`}>
              noise {'±'}
              {(noise.halfWidth * 100).toFixed(1)}
            </span>
          ) : (
            <span className={styles.noise}>no band</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PassTrack({ passes }: { passes: boolean[] }) {
  return (
    <span
      className={styles.track}
      role="img"
      aria-label={`${passes.filter(Boolean).length} of ${passes.length} pass`}
    >
      {passes.map((p, i) => (
        <span key={i} className={styles.dot} data-pass={p || undefined} aria-hidden>
          {p ? '✓' : '✗'}
        </span>
      ))}
    </span>
  );
}

export function SweepView() {
  const { model, cohorts, ctx, items: filteredCompareItems, c } = useCompare();
  const [f, reverse, setF] = useSweepFilters();
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<{
    key: 'default' | 'issue' | 'left' | 'right' | 'move';
    dir: 'asc' | 'desc';
  }>({ key: 'default', dir: 'desc' });
  const direction = ctx.direction;
  const grouped = useMemo(
    () => (cohorts && direction ? computeGroupedComparison(model, cohorts, ctx) : null),
    [model, cohorts, ctx, direction],
  );
  const displayed = useMemo(
    () => (grouped ? grouped.items.map((i) => (reverse ? reverseSweepItem(i) : i)) : []),
    [grouped, reverse],
  );
  const keys = useMemo(() => sweepMetadataKeys(displayed), [displayed]);
  const key = keys.includes(f.key) ? f.key : 'all';
  const values = useMemo(() => sweepMetadataValues(displayed, key), [displayed, key]);
  const effective: SweepFilters = {
    ...f,
    key,
    values: f.values ? f.values.filter((v) => values.includes(v)) : null,
  };
  const shown = useMemo(() => {
    const list = filterSweepItems(displayed, effective);
    const d = sort.dir === 'asc' ? 1 : -1;
    const cmp: Record<string, (a: SweepItem, b: SweepItem) => number> = {
      issue: (a, b) => d * a.itemId.localeCompare(b.itemId),
      left: (a, b) => d * (a.leftPassCount - b.leftPassCount),
      right: (a, b) => d * (a.rightPassCount - b.rightPassCount),
      move: (a, b) => d * (a.move - b.move),
    };
    return [...list].sort((a, b) =>
      sort.key !== 'default' ? cmp[sort.key]!(a, b) || defaultSweepSort(a, b) : defaultSweepSort(a, b),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, f.move, f.outcome, f.q, key, f.values, f.mode, f.only, sort]);
  void filteredCompareItems;
  if (!cohorts)
    return (
      <EmptyState
        title="Sweep needs two cohorts"
        body="Open two cohorts of equal size from the Runs page (Cohort button), or compare exactly two models with the same number of runs."
      />
    );
  if (!direction)
    return (
      <EmptyState
        title={`${ctx.metric} declares no direction`}
        body={`Sweep cannot say which side is better. Declare direction="maximize" or "minimize" in its SDK MetricSpec, or choose another metric.`}
        action={
          <Button variant="neutral" onPress={() => c.setView({ tab: 'compare' })}>
            Back to Compare
          </Button>
        }
      />
    );
  if (model.types[ctx.metric] === 'numeric')
    return (
      <EmptyState
        title="Sweep needs a pass/fail metric"
        body="This metric is numeric; choose a boolean or percentage metric."
      />
    );
  if (!grouped || !grouped.eligibleItems)
    return (
      <EmptyState
        title="Nothing to sweep"
        body="No aligned items have scored data across all selected runs for this metric."
      />
    );

  const left = reverse ? cohorts.rightLabel : cohorts.leftLabel;
  const right = reverse ? cohorts.leftLabel : cohorts.rightLabel;
  const k = grouped.k;
  const summary = summarizeSweepItems(
    shown,
    grouped.leftRunCount,
    grouped.rightRunCount,
    grouped.reportK,
    direction,
  );
  const noise = summary.noise;
  const estimated = grouped.reportK && grouped.reportK !== k ? grouped.reportK : null;
  const basis = noise?.avgAtK
    ? { label: `Avg@${k}`, stat: noise.avgAtK }
    : noise?.passAtK
      ? { label: `Pass@${estimated ?? k}`, stat: noise.passAtK }
      : null;
  const metricRole =
    ctx.metric !== model.defaultMetric
      ? 'selected metric'
      : model.specs[ctx.metric]?.primary
        ? 'declared primary metric'
        : 'first metric (no primary declared)';
  const only = (v: string) =>
    setF({ only: f.only.includes(v) ? f.only.filter((x) => x !== v) : [v], values: [v], mode: 'include' });
  const sortBy = (kk: typeof sort.key) =>
    setSort((s) =>
      s.key === kk ? { key: kk, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: kk, dir: 'desc' },
    );
  // Metadata breakdown
  const bk =
    key !== 'all'
      ? key
      : keys.includes('domain')
        ? 'domain'
        : keys.includes('complexity')
          ? 'complexity'
          : (keys[0] ?? '');
  const bvalues = bk ? sweepMetadataValues(shown, bk) : [];
  const brows = bvalues.map((v) => {
    const subset = shown.filter((i) => getMetadataCategoryValues(i.metadata, bk).includes(v));
    return {
      value: v,
      n: subset.length,
      s: summarizeSweepItems(subset, grouped.leftRunCount, grouped.rightRunCount, null, direction),
    };
  });
  const sweepOpenItem = open ? displayed.find((i) => i.itemId === open) : null;
  return (
    <div className={styles.sweep} data-testid="sweep-view">
      <header className={styles.head}>
        <div>
          <Text variant="xl" as="h2">
            Sweep
          </Text>
          <Text variant="sm" tone="muted">
            {left} vs {right} across {k} runs per cohort {'·'} {ctx.metric} {'·'} {shown.length}/
            {displayed.length} items shown
          </Text>
        </div>
        <Button
          size="sm"
          variant="neutral"
          aria-pressed={reverse}
          onPress={() => setF({ reverse: !reverse })}
        >
          Reverse sides
        </Button>
      </header>

      {basis ? (
        <div className={styles.verdict} data-verdict={basis.stat.verdict} role="status">
          <Badge
            tone={
              basis.stat.verdict === 'improved'
                ? 'success'
                : basis.stat.verdict === 'regressed'
                  ? 'danger'
                  : 'neutral'
            }
          >
            {basis.stat.verdict === 'improved'
              ? 'IMPROVED'
              : basis.stat.verdict === 'regressed'
                ? 'REGRESSED'
                : 'WITHIN NOISE'}
          </Badge>
          <div>
            <Text variant="md" weight={600}>
              {basis.label} {signed(basis.stat.delta)} {'—'}{' '}
              {basis.stat.verdict === 'within_noise' ? 'not distinguishable from run luck' : 'beyond noise'}
            </Text>
            <Text variant="sm" tone="muted">
              {ctx.metric}
              {direction === 'minimize' ? ' · lower is better' : ''} {'·'} noise {'±'}
              {(basis.stat.halfWidth * 100).toFixed(1)}% at 95% {'·'}{' '}
              {basis.stat.pValue < 0.001 ? 'p < 0.001' : `p = ${basis.stat.pValue.toFixed(3)}`} {'·'}{' '}
              {basis.stat.items} paired items {'·'} {metricRole} {'—'} other metrics below are context
            </Text>
          </div>
        </div>
      ) : null}
      <Text variant="sm" tone="muted">
        {metricDirectionLabel(direction)}
      </Text>

      <div className={styles.filters} role="group" aria-label="Sweep filters">
        <Select
          label="Move"
          value={f.move}
          onChange={(v) => v && setF({ move: String(v) as SweepMove })}
          items={[
            { key: 'all', label: 'All items' },
            { key: 'improved', label: 'Improved' },
            { key: 'regressed', label: 'Regressed' },
            { key: 'unchanged', label: 'Unchanged' },
          ]}
          width={150}
        />
        <Select
          label="Outcome"
          value={f.outcome}
          onChange={(v) => v && setF({ outcome: String(v) as SweepOutcome })}
          items={[
            { key: 'all', label: 'All outcomes' },
            { key: 'left_sweeps_right', label: `${left} sweeps ${right}` },
            { key: 'right_sweeps_left', label: `${right} sweeps ${left}` },
            { key: 'both_pass', label: 'Both pass' },
            { key: 'both_fail', label: 'Both fail' },
            { key: 'mixed', label: 'Mixed' },
          ]}
          width={200}
        />
        <SearchField
          label="Search sweep items"
          placeholder="Item id, domain, complexity"
          value={f.q}
          onChange={(q) => setF({ q })}
          onClear={() => setF({ q: '' })}
          width="14rem"
        />
        <Select
          label="Metadata"
          value={key}
          onChange={(v) => v && setF({ key: String(v), values: null, only: [], mode: 'include' })}
          items={[{ key: 'all', label: 'All categories' }, ...keys.map((x) => ({ key: x, label: x }))]}
          width={170}
        />
        <MultiSelect
          label="Values"
          items={values.map((v) => ({ key: v, label: v }))}
          value={new Set(f.values ?? values)}
          isDisabled={key === 'all'}
          onChange={(set) =>
            setF({ values: set.size >= values.length ? null : Array.from(set).map(String), only: [] })
          }
          onlyAction
          selectAll
        />
        <Checkbox
          isSelected={f.only.length > 0}
          isDisabled={key === 'all' || !sweepKeySupportsOnly(displayed, key) || !f.values?.length}
          onChange={(on) => setF({ only: on && f.values ? f.values : [] })}
        >
          Exclusive only
        </Checkbox>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          compact
          title="No items match these filters"
          action={
            <Button variant="neutral" onPress={() => setF({ ...DEFAULT_SWEEP_FILTERS })}>
              Reset sweep filters
            </Button>
          }
        />
      ) : (
        <>
          <section aria-label="Cohort metrics">
            <Text variant="md" weight={600}>
              Cohort metrics
            </Text>
            <div className={styles.stats}>
              <StatCard
                label={estimated ? `Pass@${estimated}` : `Pass@${k}`}
                from={summary.left.passAtK}
                to={summary.right.passAtK}
                delta={summary.deltas.passAtK}
                noise={noise?.passAtK ?? null}
                help={
                  estimated
                    ? `pass@${estimated} estimated from all ${k} passes`
                    : 'Share of items on which at least one run passes.'
                }
              />
              <StatCard
                label={`Avg@${k}`}
                from={summary.left.avgAtK}
                to={summary.right.avgAtK}
                delta={summary.deltas.avgAtK}
                noise={noise?.avgAtK ?? null}
                help="Average score across every execution."
              />
              <StatCard
                label="Consistency"
                from={summary.left.consistency}
                to={summary.right.consistency}
                delta={summary.deltas.consistency}
                noise={noise?.consistency ?? null}
                help="Do executions of a cohort agree on pass or fail?"
              />
              <StatCard
                label="Reliability"
                from={summary.left.reliability}
                to={summary.right.reliability}
                delta={summary.deltas.reliability}
                noise={null}
                help="Share of executions that pass on items a cohort can solve. Not banded: its exclusion rule makes the aggregate nonlinear."
              />
              <StatCard
                label={estimated ? `Pass^${estimated}` : `Pass^${k}`}
                from={summary.left.passHatK}
                to={summary.right.passHatK}
                delta={summary.deltas.passHatK}
                noise={noise?.passHatK ?? null}
                help="Share of items on which every execution passes."
              />
            </div>
          </section>

          {brows.length ? (
            <section aria-label={`Cohort metrics by ${bk}`}>
              <Text variant="md" weight={600}>
                Cohort metrics by {bk}
              </Text>
              <ScrollRegion className={styles.scroll} label={`${bk} breakdown`}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{bk}</th>
                      <th scope="col">N</th>
                      <th scope="col">Pass@{k}</th>
                      <th scope="col">Avg@{k}</th>
                      <th scope="col">Consistency</th>
                      <th scope="col">Reliability</th>
                      <th scope="col">Pass^{k}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brows.map((r) => (
                      <tr
                        key={r.value}
                        data-active={(f.key === bk && f.values?.includes(r.value)) || undefined}
                      >
                        <th scope="row">
                          <button
                            type="button"
                            className={styles.link}
                            aria-pressed={f.key === bk && !!f.values?.includes(r.value)}
                            onClick={() =>
                              f.key === bk && f.values?.length === 1 && f.values[0] === r.value
                                ? sweepKeySupportsOnly(displayed, bk) && !f.only.includes(r.value)
                                  ? only(r.value)
                                  : setF({ key: 'all', values: null, only: [] })
                                : setF({ key: bk, values: [r.value], only: [], mode: 'include' })
                            }
                          >
                            {r.value}
                          </button>
                        </th>
                        <td>{r.n}</td>
                        {(
                          [['passAtK'], ['avgAtK'], ['consistency'], ['reliability'], ['passHatK']] as const
                        ).map(([m]) => {
                          // Avg@k is the metric's own value: on a minimize metric a drop is the improvement.
                          const good = breakdownDeltaGood(m, r.s.deltas[m] ?? 0, direction);
                          return (
                            <td key={m}>
                              <span className={styles.mono}>
                                {pct(r.s.left[m] as number | null, 0)} {'→'}{' '}
                                <strong>{pct(r.s.right[m] as number | null, 0)}</strong>
                              </span>{' '}
                              <Tag
                                kind="data"
                                tone={good > 0.0005 ? 'success' : good < -0.0005 ? 'danger' : undefined}
                              >
                                {signed(r.s.deltas[m] ?? 0, 0)}
                              </Tag>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </section>
          ) : null}

          <section aria-label="Outcome summary">
            <Text variant="md" weight={600}>
              Outcome summary
            </Text>
            <div className={styles.outcomes}>
              {[
                ['Total items', shown.length, null, undefined],
                ['Improved', summary.counts.improved, 'improved', 'move'],
                ['Regressed', summary.counts.regressed, 'regressed', 'move'],
                ['Unchanged', summary.counts.unchanged, 'unchanged', 'move'],
                ['Decisively fixed', summary.counts.decisivelyFixed, 'right_sweeps_left', 'outcome'],
                ['Decisively broken', summary.counts.decisivelyBroken, 'left_sweeps_right', 'outcome'],
              ].map(([label, n, value, kind]) => {
                const active =
                  kind === 'move' ? f.move === value : kind === 'outcome' ? f.outcome === value : false;
                return (
                  <button
                    key={String(label)}
                    type="button"
                    className={styles.outcome}
                    aria-pressed={kind ? active : undefined}
                    disabled={!kind}
                    onClick={() =>
                      kind === 'move'
                        ? setF({ move: active ? 'all' : (value as SweepMove) })
                        : setF({ outcome: active ? 'all' : (value as SweepOutcome) })
                    }
                  >
                    <span className={styles.outcomeValue}>{String(n)}</span>
                    <span className={styles.outcomeLabel}>{String(label)}</span>
                  </button>
                );
              })}
              <div className={styles.outcome}>
                <span className={styles.outcomeValue}>{summary.counts.avgAttemptsDelta.toFixed(2)}</span>
                <span className={styles.outcomeLabel}>Avg {'Δ'} attempts / item</span>
              </div>
            </div>
          </section>

          <section aria-label="Items">
            <ScrollRegion className={styles.scroll} label="Sweep items">
              <table className={styles.table}>
                <thead>
                  <tr>
                    {(
                      [
                        ['issue', 'Item'],
                        [null, 'Metadata'],
                        ['left', left],
                        ['right', right],
                        ['move', 'Move'],
                      ] as const
                    ).map(([kk, label]) => (
                      <th
                        scope="col"
                        key={label}
                        aria-sort={
                          kk && sort.key === kk
                            ? sort.dir === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : undefined
                        }
                      >
                        {kk ? (
                          <button type="button" className={styles.link} onClick={() => sortBy(kk)}>
                            {label} {sort.key === kk ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => (
                    <tr key={item.itemId} className={styles.itemRow} data-outcome={sweepOutcomeOf(item)}>
                      <th scope="row">
                        <button
                          type="button"
                          className={styles.link}
                          onClick={() => setOpen(item.itemId)}
                          aria-label={`Open item ${item.itemId}`}
                        >
                          {item.itemId}
                        </button>
                      </th>
                      <td>
                        {['domain', 'complexity']
                          .flatMap((m) => getMetadataCategoryValues(item.metadata, m))
                          .slice(0, 4)
                          .map((v) => (
                            <Tag key={v} kind="data">
                              {v}
                            </Tag>
                          ))}
                      </td>
                      <td>
                        <PassTrack passes={item.leftPasses} />
                      </td>
                      <td>
                        <PassTrack passes={item.rightPasses} />
                      </td>
                      <td>
                        <Tag
                          kind="data"
                          tone={item.move > 0 ? 'success' : item.move < 0 ? 'danger' : undefined}
                        >
                          {item.move > 0 ? `+${item.move}` : item.move}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>
        </>
      )}
      {open ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(null)}
          size="data"
          title={`Item ${open}`}
          description={
            sweepOpenItem
              ? `${left}: ${sweepOpenItem.leftPassCount}/${sweepOpenItem.leftPasses.length} pass · ${right}: ${sweepOpenItem.rightPassCount}/${sweepOpenItem.rightPasses.length} pass`
              : undefined
          }
        >
          <ItemDetail itemId={open} />
        </Dialog>
      ) : null}
    </div>
  );
}
