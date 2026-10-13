/**
 * The Charts card table on the shared DataTable: runs as rows, metrics as ScoreBar columns,
 * latency/tokens as relative-scale bars. Grouped mode: one level uses `groupBy` (summary
 * aggregates under the columns); version/model nesting renders both levels as aggregate rows.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button as AriaButton } from 'react-aria-components';
import type { MetricType } from '@/api/dashboardTypes';
import { DataTable, Icon, NumberCell, ScoreBar, Tag, Text, Tooltip, type Column } from '@/ui';
import { formatDateParts, formatLatency, formatNumericValue, formatPercentValue } from '@/lib/format';
import { runPath } from '@/app/routes';
import { Mono, ModelMark } from './cells';
import { useRunsCtx } from './context';
import { modelSlot } from './model';
import {
  GROUP_STAT_COLUMNS,
  GROUP_STAT_KEYS,
  firstColumnLabel,
  modelLabel,
  type ChartGroup,
  type ChartRun,
  type GroupMode,
  type SortDir,
  type TraceMetricColumn,
} from './chartModel';
import type { GroupStats } from '@/api/dashboardTypes';
import styles from './ChartsTable.module.css';

type StatKind = 'passAtK' | 'consistency' | 'reliability';
const STAT_KIND: Record<string, StatKind> = {
  [GROUP_STAT_KEYS.passAtK]: 'passAtK',
  [GROUP_STAT_KEYS.consistency]: 'consistency',
  [GROUP_STAT_KEYS.reliability]: 'reliability',
};

interface RunRowT {
  kind: 'run';
  id: string;
  run: ChartRun;
  /** Indent depth (0 = flat, 1 = under a group, 2 = under a sub-group). */
  depth: 0 | 1 | 2;
  /** `groupBy` path: the id of the group the run belongs to. */
  gid?: string;
}
interface GroupRowT {
  kind: 'group';
  id: string;
  g: ChartGroup;
  level: 1 | 2;
  open: boolean;
}
type Row = RunRowT | GroupRowT;

export interface ChartsTableProps {
  slug: string;
  task: string;
  dataset: string;
  runs: ChartRun[];
  groups: ChartGroup[];
  groupMode: GroupMode;
  /** Initial open state of every group (Expand all / Collapse all remount the table). */
  defaultOpen: boolean;
  barMetrics: string[];
  plainMetrics: string[];
  traces: TraceMetricColumn[];
  showLatency: boolean;
  showMedian: boolean;
  statKinds: StatKind[];
  metricTypes: Record<string, MetricType>;
  scaleMax: Record<string, number>;
  maxLatency: number;
  maxMedian: number;
  traceMax: Record<string, number>;
  sort: { key: string; dir: SortDir };
  onSort: (key: string, dir: SortDir) => void;
  statsMap: Record<string, GroupStats>;
  statsBusy: boolean;
  /** False when the card has no metric with a declared direction (pass rates unavailable). */
  statsAvailable: boolean;
}

function Series({ modelKey, muted, children }: { modelKey: string; muted?: boolean; children: ReactNode }) {
  const { modelIndex } = useRunsCtx();
  return (
    <span
      className={styles.series}
      data-series={modelSlot(modelKey, modelIndex)}
      data-muted={muted ? '' : undefined}
    >
      {children}
    </span>
  );
}

function GroupStat({
  value,
  loading,
  unavailable,
  single,
  k,
}: {
  value: number | null | undefined;
  loading: boolean;
  unavailable: boolean;
  single: boolean;
  k?: number;
}) {
  const text = unavailable
    ? '—'
    : loading
      ? 'Computing…'
      : single
        ? 'Needs k ≥ 2'
        : value == null
          ? 'NA'
          : formatPercentValue(value);
  const tip = unavailable
    ? 'Pass rates need a metric with a declared direction.'
    : single
      ? 'Consistency and reliability need repeat runs (k ≥ 2).'
      : `Computed on the server over this group's runs${k ? ` (k = ${k})` : ''}`;
  return (
    <Tooltip content={tip}>
      <AriaButton className={styles.statButton}>
        <Mono>{text}</Mono>
      </AriaButton>
    </Tooltip>
  );
}

export function ChartsTable(p: ChartsTableProps) {
  const { slug, groupMode, groups, runs } = p;
  const nested = groups.some((g) => g.children);
  const grouped = groupMode !== 'run';
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setToggled((t) => {
      const n = new Set(t);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const rows = useMemo<Row[]>(() => {
    const run = (r: ChartRun, depth: 0 | 1 | 2, gid?: string): RunRowT => ({
      kind: 'run',
      id: r.run_id,
      run: r,
      depth,
      gid,
    });
    if (!grouped) return runs.map((r) => run(r, 0));
    if (!nested) return groups.flatMap((g) => g.runs.map((r) => run(r, 1, g.id)));
    const out: Row[] = [];
    for (const g of groups) {
      const open = p.defaultOpen !== toggled.has(g.id);
      out.push({ kind: 'group', id: g.id, g, level: 1, open });
      if (!open) continue;
      for (const c of g.children ?? []) {
        const cOpen = p.defaultOpen !== toggled.has(c.id);
        out.push({ kind: 'group', id: c.id, g: c, level: 2, open: cOpen });
        if (cOpen) for (const r of c.runs) out.push(run(r, 2));
      }
    }
    return out;
  }, [grouped, nested, runs, groups, p.defaultOpen, toggled]);

  const firstSortable = !(groupMode === 'version' || groupMode === 'version-model');
  const columns = useMemo<Column<Row>[]>(() => {
    const cols: Column<Row>[] = [];

    const groupLabel = (g: ChartGroup, level: 1 | 2, open: boolean | null): ReactNode => (
      <span className={styles.head} data-level={level}>
        {open !== null ? (
          <AriaButton
            className={styles.toggle}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${g.label}`}
            onPress={() => toggle(g.id)}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </AriaButton>
        ) : null}
        {g.kind === 'model' && g.model ? <ModelMark modelKey={g.model} size="md" /> : null}
        <Text variant="base" as="span" weight={600} tone="primary">
          {g.label}
        </Text>
        <Tag kind="count">{g.runs.length} runs</Tag>
      </span>
    );

    cols.push({
      id: 'model',
      header: grouped ? firstColumnLabel(groupMode) : 'Model',
      sort: firstSortable ? { key: 'model', first: 'asc' } : undefined,
      width: 280,
      minWidth: 200,
      hideable: false,
      resizable: true,
      mono: false,
      cell: (row) => {
        if (row.kind === 'group') return groupLabel(row.g, row.level, row.open);
        const r = row.run;
        const date = formatDateParts(r.timestamp);
        const grp = row.depth ? groupMode : null;
        const dateLabel = grp === 'model' || grp === 'version-model';
        return (
          <span className={styles.head} data-depth={row.depth}>
            <ModelMark modelKey={r.model} />
            <Link to={runPath(slug, r.run_id)} className={styles.rowLink} title={r.run_name}>
              {dateLabel ? `${date.date} · ${date.time}` : modelLabel(r.model)}
            </Link>
            {!dateLabel ? <Mono className={styles.rowDate}>{date.date}</Mono> : null}
            {r.git_commit && grp !== 'version' ? (
              <Tag kind="version" title={`${r.git_branch}/${r.git_commit}`}>
                {r.git_commit}
              </Tag>
            ) : null}
          </span>
        );
      },
    });

    const groupOfRows = (rs: Row[]): ChartGroup | undefined => {
      const first = rs[0];
      return first && first.kind === 'run' && first.gid ? groupById.get(first.gid) : undefined;
    };
    /** `summary` for the groupBy path, built from the group the rows belong to. */
    const summary = (render: (g: ChartGroup) => ReactNode) =>
      grouped && !nested
        ? (rs: Row[]) => {
            const g = groupOfRows(rs);
            return g ? render(g) : null;
          }
        : undefined;
    const pick = (row: Row, render: (g: ChartGroup) => ReactNode, runCell: (r: ChartRun) => ReactNode) =>
      row.kind === 'group' ? render(row.g) : runCell(row.run);
    const modelOf = (g: ChartGroup) => g.model ?? g.runs[0]?.model ?? '';
    const metricText = (m: string, v: number | null | undefined) =>
      p.metricTypes[m] === 'numeric' ? formatNumericValue(v, 2) : formatPercentValue(v);

    for (const m of p.barMetrics) {
      const aggBar = (g: ChartGroup) => (
        <Series modelKey={modelOf(g)} muted={g.kind !== 'model'}>
          <ScoreBar
            value={g.agg.metricAverages[m]}
            max={p.scaleMax[m] ?? 1}
            text={metricText(m, g.agg.metricAverages[m])}
          />
        </Series>
      );
      cols.push({
        id: m,
        header: m.replace(/_/g, ' '),
        group: 'Metrics',
        type: 'score',
        sort: { key: m, first: 'desc' },
        width: 160,
        minWidth: 120,
        cell: (row) =>
          pick(row, aggBar, (r) => (
            <Series modelKey={r.model}>
              <ScoreBar
                value={r.metric_averages[m]}
                max={p.scaleMax[m] ?? 1}
                text={metricText(m, r.metric_averages[m])}
              />
            </Series>
          )),
        summary: summary(aggBar),
      });
    }
    for (const m of p.plainMetrics) {
      const agg = (g: ChartGroup) => <NumberCell value={g.agg.metricAverages[m]} decimals={2} />;
      cols.push({
        id: m,
        header: m.replace(/_/g, ' '),
        group: 'Metrics',
        type: 'number',
        sort: { key: m, first: 'desc' },
        width: 110,
        minWidth: 90,
        cell: (row) => pick(row, agg, (r) => <NumberCell value={r.metric_averages[m]} decimals={2} />),
        summary: summary(agg),
      });
    }
    const system = (
      id: string,
      header: string,
      value: (r: ChartRun) => number | null | undefined,
      max: number,
      aggValue: (g: ChartGroup) => string,
      format: (v: number | null | undefined) => string,
    ) => {
      const agg = (g: ChartGroup) => <Mono>{aggValue(g)}</Mono>;
      cols.push({
        id,
        header,
        group: 'System',
        type: 'score',
        sort: { key: id, first: 'desc' },
        width: 150,
        minWidth: 120,
        cell: (row) =>
          pick(row, agg, (r) => (
            <Series modelKey={r.model}>
              <ScoreBar value={value(r) || null} max={max} text={format(value(r))} />
            </Series>
          )),
        summary: summary(agg),
      });
    };
    if (p.showLatency)
      system(
        'latency',
        '⚡ Avg latency',
        (r) => r.latency,
        p.maxLatency,
        (g) => formatLatency(g.agg.avgLatency),
        formatLatency,
      );
    if (p.showMedian)
      system(
        'median-latency',
        '⚡ Median latency',
        (r) => r.median_latency,
        p.maxMedian,
        (g) => formatLatency(g.agg.medianLatency),
        formatLatency,
      );
    for (const t of p.traces) {
      const agg = (g: ChartGroup) => <Mono>{t.format(g.agg.traceAverages[t.key])}</Mono>;
      cols.push({
        id: t.key,
        header: `⚡ ${t.label}`,
        group: 'System',
        type: 'score',
        sort: { key: t.key, first: 'desc' },
        width: 150,
        minWidth: 120,
        cell: (row) =>
          pick(row, agg, (r) => {
            const v = r.trace_stats?.[t.key] as number | undefined;
            return (
              <Series modelKey={r.model}>
                <ScoreBar value={v ?? null} max={p.traceMax[t.key] ?? 1} text={t.format(v)} />
              </Series>
            );
          }),
        summary: summary(agg),
      });
    }
    if (grouped) {
      for (const c of GROUP_STAT_COLUMNS.filter((c) => p.statKinds.includes(STAT_KIND[c.key]!))) {
        const kind = STAT_KIND[c.key]!;
        const stat = (g: ChartGroup) => {
          const stats = p.statsMap[g.id];
          return (
            <GroupStat
              value={stats?.[kind]}
              loading={p.statsAvailable && !stats && p.statsBusy}
              unavailable={!p.statsAvailable}
              single={stats?.K === 1 && kind !== 'passAtK'}
              k={stats?.K}
            />
          );
        };
        cols.push({
          id: c.key,
          header: c.label,
          group: 'Repeat runs',
          type: 'number',
          sort: { key: c.key, first: 'desc' },
          width: 120,
          minWidth: 100,
          cell: (row) => (row.kind === 'group' ? stat(row.g) : null),
          summary: summary(stat),
        });
      }
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, grouped, nested, groupMode, firstSortable, groupById, toggled]);

  const groupBy = useMemo(
    () =>
      grouped && !nested
        ? {
            key: (row: Row) => (row.kind === 'run' ? (row.gid ?? '') : ''),
            label: (key: string) => {
              const g = groupById.get(key);
              if (!g) return key;
              return (
                <span className={styles.head} data-level={1}>
                  {g.kind === 'model' && g.model ? <ModelMark modelKey={g.model} size="md" /> : null}
                  <Text variant="base" as="span" weight={600} tone="primary">
                    {g.label}
                  </Text>
                </span>
              );
            },
            collapsible: true,
            defaultCollapsed: !p.defaultOpen,
          }
        : undefined,
    [grouped, nested, groupById, p.defaultOpen],
  );

  return (
    <div className={styles.wrap}>
      <DataTable<Row>
        aria-label={`${p.task} · ${p.dataset} runs`}
        variant="embedded"
        responsive="scroll"
        zebra={false}
        columnMenu={false}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={{ key: p.sort.key, direction: p.sort.dir }}
        onSortChange={(s) => s && p.onSort(s.key, s.direction)}
        groupBy={groupBy}
        empty={`No runs for ${p.dataset} match the current filters.`}
        rowProps={(row) =>
          row.kind === 'group' ? { 'data-chart-group': String(row.level) } : { 'data-chart-run': '' }
        }
      />
    </div>
  );
}
