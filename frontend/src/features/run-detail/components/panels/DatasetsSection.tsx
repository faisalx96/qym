/**
 * The Datasets section of a union run (several dataset versions in one run): the score per source dataset beside the
 * run's own mean. Fed by `GET /api/runs/{id}/datasets`, requested with the page (never for a single dataset).
 */
import { useDatasetBreakdownQuery } from '@/api/runs';
import { formatPercent, formatMetricObservation } from '@/lib/metrics';
import {
  DataTable,
  DatasetTag,
  ErrorState,
  Icon,
  ReportSection,
  ScoreValue,
  Skeleton,
  Tag,
  type Column,
} from '@/ui';
import { alignToElement } from '@/lib/scrollToElement';
import { datasetKey } from '../../lib/datasetFilter';
import { sectionDomId } from '../ReportSections';
import { useRunPage } from '../../RunContext';
import type { DatasetBreakdown, DatasetBreakdownRow } from '../../types';
import styles from './DatasetsSection.module.css';

type MetricMean = { mean: number | null; count: number };

interface Line {
  key: string;
  /** null = the "Not tagged" row. */
  position: number | null;
  name: string;
  version: string | null;
  alias: string | null;
  deleted: boolean;
  items: number | null;
  errors: number | null;
  metrics: Record<string, MetricMean>;
}

/** Dataset mean minus run mean: percentage points for percent metrics, the raw difference otherwise. */
export function deltaText(value: number | null, mean: number | null, percent: boolean): string {
  if (value == null || mean == null) return '';
  const d = percent ? (value - mean) * 100 : value - mean;
  if (Math.abs(d) < 0.05) return '0.0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

function linesOf(
  rows: DatasetBreakdownRow[] | undefined,
  entries: ReturnType<typeof useRunPage>['payload']['run']['datasets'],
  unassigned: number,
): Line[] {
  const known = entries ?? [];
  const base: Line[] = (rows ?? known.map((e) => ({ ...e, items: null }))).map((r) => {
    const entry = known.find((e) => e.position === r.position);
    return {
      key: String(r.position),
      position: r.position,
      name: r.dataset,
      version: r.version,
      alias: entry?.alias ?? r.alias ?? null,
      deleted: r.deleted,
      items: rows ? (r.items ?? null) : null,
      errors: rows ? ((r as DatasetBreakdownRow).errors ?? null) : null,
      metrics: (rows ? (r as DatasetBreakdownRow).metrics : undefined) ?? {},
    };
  });
  if (unassigned > 0)
    base.push({
      key: 'untagged',
      position: null,
      name: 'Not tagged',
      version: null,
      alias: null,
      deleted: false,
      items: unassigned,
      errors: null,
      metrics: {},
    });
  return base;
}

export function DatasetsSection() {
  const { runId, payload, model, api, basePath } = useRunPage();
  const run = payload.run;
  const count = run.dataset_count ?? 1;
  const query = useDatasetBreakdownQuery(runId, model.viewPass, count > 1);
  const data: DatasetBreakdown | undefined = query.data;
  const loading = !data && !query.isError;
  const lines = linesOf(data?.datasets, run.datasets, data?.unassigned?.items ?? 0);
  const total = data?.run;
  const skeleton = (width: number) => <Skeleton kind="value" width={width} height={12} />;
  const show = (line: Line) => {
    if (line.position == null) return;
    api.setView({ dataset: datasetKey(line.name, line.version) });
    const target = document.getElementById('run-items');
    if (target) alignToElement(target);
  };
  const columns: Column<Line>[] = [
    {
      id: 'dataset',
      header: 'Dataset',
      width: 150,
      flex: true,
      minWidth: 150,
      priority: 1,
      cardTitle: true,
      cell: (l) =>
        l.position == null ? (
          <span className={styles.untagged}>{l.name}</span>
        ) : (
          <span className={styles.dsCell}>
            <DatasetTag name={l.name} version={l.version} aliases={l.alias ? [l.alias] : []} />
            {l.deleted ? <span className={styles.deleted}>deleted</span> : null}
          </span>
        ),
      summary: <span className={styles.sumLabel}>All datasets</span>,
    },
    {
      id: 'items',
      header: 'Items',
      width: 60,
      priority: 2,
      type: 'number',
      cell: (l) =>
        loading || l.items == null ? (
          skeleton(36)
        ) : (
          <span className={styles.num}>{l.items.toLocaleString('en-US')}</span>
        ),
      summary: total ? (
        <span className={styles.num}>{total.items.toLocaleString('en-US')}</span>
      ) : (
        skeleton(36)
      ),
    },
    {
      id: 'errors',
      header: 'Errors',
      width: 60,
      priority: 2,
      type: 'number',
      cell: (l) =>
        l.position == null ? null : loading || l.errors == null ? (
          skeleton(20)
        ) : (
          <span className={styles.num}>{l.errors}</span>
        ),
      summary: total ? <span className={styles.num}>{total.errors}</span> : skeleton(20),
    },
    ...model.metricNames.map<Column<Line>>((m) => {
      const type = model.metricTypes[m] ?? 'score';
      const direction = model.metricDirections[m] ?? null;
      const percent = type !== 'numeric';
      const spec = model.metricSpecs[m];
      const text = (v: number | null) =>
        v == null
          ? '—'
          : type === 'numeric'
            ? formatMetricObservation(v, type, spec)
            : type === 'boolean'
              ? formatPercent(v, 0)
              : formatPercent(v, 1);
      return {
        id: `metric:${m}`,
        header: m,
        label: m,
        group: 'Mean score',
        width: 104,
        priority: 2,
        type: 'number',
        cell: (l) => {
          if (l.position == null) return null;
          if (loading) return skeleton(48);
          const mean = l.metrics[m]?.mean ?? null;
          return (
            <span className={styles.scoreCell}>
              <ScoreValue value={mean} type={type} direction={direction} text={text(mean)} />
              <span className={styles.delta}>
                {deltaText(mean, total?.metrics[m]?.mean ?? null, percent)}
              </span>
            </span>
          );
        },
        summary: total ? (
          <ScoreValue
            value={total.metrics[m]?.mean ?? null}
            type={type}
            direction={direction}
            text={text(total.metrics[m]?.mean ?? null)}
          />
        ) : (
          skeleton(48)
        ),
      };
    }),
    {
      id: 'show',
      header: '',
      label: 'Show items',
      hideLabel: true,
      width: 88,
      priority: 1,
      cell: (l) =>
        l.position == null || l.items == null ? null : (
          <button
            type="button"
            className={styles.showLink}
            data-link="block"
            data-testid="show-items-link"
            onClick={() => show(l)}
          >
            Show {l.items.toLocaleString('en-US')} <Icon name="chevron-right" size={12} />
          </button>
        ),
    },
  ];
  void basePath;
  return (
    <ReportSection
      id={sectionDomId('datasets')}
      title="Datasets"
      description="Scores per source dataset. The run’s own mean is the summary row; the grey figure is each dataset’s distance from it."
      aside={
        <Tag kind="count">
          <Icon name="database" size={12} /> {count} datasets
        </Tag>
      }
    >
      {query.isError ? (
        <ErrorState
          compact
          error={query.error}
          title="Couldn’t load the datasets"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DataTable<Line>
          aria-label="Scores per dataset"
          density="regular"
          rows={lines}
          rowKey={(l) => l.key}
          columns={columns}
          data-testid="dataset-breakdown"
        />
      )}
    </ReportSection>
  );
}
