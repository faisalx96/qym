/** Performance run page, Progress tab: users over time, then one row per level. */
import { isPerformanceRunActive, type PerformanceRunRead } from '@/api/performance';
import { Card, CardTitle, DataTable, Skeleton, StateTag, type Column } from '@/ui';
import { KINDS, KIND_NAME, P95_HINT, count, pct, seconds, secs } from '../../lib/format';
import { OUTCOME_TONE, levelOutcomes } from '../../lib/status';
import { Legend, PlotCard, Stepladder } from '../shared';
import { Limits } from './Limits';
import { levelRows, type LevelRow } from './levels';
import styles from './run.module.css';

function levelColumns(): Column<LevelRow>[] {
  const time = 'Answer time, seconds';
  const kinds = 'p95 by kind, seconds';
  return [
    {
      id: 'level',
      header: 'Level',
      hint: 'Users at this level.',
      width: 60,
      mono: true,
      primary: true,
      cell: (r) => r.level,
    },
    {
      id: 'result',
      header: 'Result',
      width: 170,
      cell: (r) => (
        <span data-performance-level-result={r.level}>
          <StateTag tone={OUTCOME_TONE[r.outcome]}>{r.word}</StateTag>
        </span>
      ),
      secondary: (r) => r.note ?? null,
    },
    {
      id: 'answers',
      header: 'Answers',
      width: 76,
      align: 'center',
      mono: true,
      cell: (r) => count(r.answers),
    },
    {
      id: 'per-minute',
      header: 'Per minute',
      hint: 'Answers per minute. When it stops rising while users rise, the system is full.',
      width: 96,
      align: 'center',
      mono: true,
      cell: (r) => (r.per_minute === null ? '–' : r.per_minute.toFixed(1)),
    },
    { id: 'errors', header: 'Errors', width: 68, align: 'center', mono: true, cell: (r) => pct(r.error_pct) },
    {
      id: 'p50',
      header: 'p50',
      headerCase: 'as-written',
      group: time,
      width: 64,
      align: 'center',
      mono: true,
      cell: (r) => seconds(r.p50_ms),
    },
    {
      id: 'p95',
      header: 'p95',
      headerCase: 'as-written',
      hint: `${P95_HINT} The Result says whether it kept the time limit.`,
      group: time,
      width: 72,
      align: 'center',
      mono: true,
      // A score in a table is its number, not a bar (§7): the Result cell already says whether it kept the limit.
      cell: (r) => seconds(r.p95_ms),
    },
    {
      id: 'p99',
      header: 'p99',
      headerCase: 'as-written',
      hint: 'Shown for a level with at least 200 answers.',
      group: time,
      width: 64,
      align: 'center',
      mono: true,
      cell: (r) => seconds(r.p99_ms),
    },
    {
      id: 'first-byte',
      header: 'First byte',
      hint: 'Time until the first part of the answer arrives; 95% were faster.',
      group: time,
      width: 96,
      align: 'center',
      mono: true,
      cell: (r) => seconds(r.first_byte_ms),
    },
    {
      id: 'quality',
      header: 'Quality',
      hint: 'Average quality of the answers, out of 100.',
      width: 76,
      align: 'center',
      mono: true,
      cell: (r) => (r.quality === null ? '–' : r.quality.toFixed(1)),
    },
    {
      id: 'no-data',
      header: 'No data',
      hint: 'Answers that said no data was available.',
      width: 76,
      align: 'center',
      mono: true,
      cell: (r) => pct(r.no_data_pct),
    },
    ...KINDS.map((kind): Column<LevelRow> => ({
      id: kind,
      header: KIND_NAME[kind],
      group: kinds,
      width: 72,
      align: 'center',
      mono: true,
      cell: (r) => seconds(r.by_kind[kind]),
    })),
  ];
}

/**
 * The Levels columns of the loading frame: the same headers, groups, widths and second line as the loaded table, each
 * cell a skeleton bone (§7 "A loading frame is the loaded layout").
 */
export function levelFrameColumns(): Column<number>[] {
  const bone = <Skeleton kind="value" width="2.5em" label="Loading the levels" />;
  return levelColumns().map((column): Column<number> => ({
    id: column.id,
    header: column.header,
    headerCase: column.headerCase,
    hint: column.hint,
    group: column.group,
    width: column.width,
    align: column.align,
    primary: column.primary,
    cell: () => bone,
    secondary: column.secondary ? () => bone : undefined,
  }));
}

export function ProgressTab({ read }: { read: PerformanceRunRead }) {
  const { config, progress } = read;
  const done = !isPerformanceRunActive(read.effective_status);
  const rows = levelRows(read);
  const outcomes = levelOutcomes(read);
  const unfinished = Object.values(outcomes).includes('not_finished');
  // The second the run ended at: the length its result states, else the last second it reported.
  const reached =
    read.summary?.headline.duration_s ?? progress?.elapsed_s ?? read.run.duration_s ?? undefined;
  return (
    <div className={styles.stack}>
      <PlotCard
        title="Users over time"
        legend={
          <Legend
            items={[
              { label: 'Passed', tone: 'success' },
              { label: 'Broke a limit', tone: 'danger' },
              { label: 'Not counted', tone: 'warning' },
              ...(done ? [] : [{ label: 'Measuring', tone: 'info' as const }]),
              ...(unfinished ? [{ label: 'Not finished', tone: 'neutral' as const }] : []),
              { label: done ? 'Not reached' : 'Waiting', tone: 'neutral' },
            ]}
          />
        }
      >
        <Stepladder
          stages={config.plan.stages}
          baseline={config.plan.baseline_users ?? config.plan.users ?? 0}
          outcomes={outcomes}
          nowS={done ? undefined : progress?.elapsed_s}
          endedS={
            done && reached !== undefined && reached < config.plan.total_seconds - 10 ? reached : undefined
          }
          height={230}
        />
      </PlotCard>
      {/* The limits of the result sit here, above the levels, not between the header and the tabs (B22). */}
      {read.summary?.thresholds.length ? <Limits thresholds={read.summary.thresholds} /> : null}
      {config.test_type === 'breakpoint' ? (
        <Card
          flush
          as="section"
          aria-label="Levels"
          data-performance-block="levels"
          header={
            <CardTitle
              title="Levels"
              description={`A level breaks when its p95 goes over ${secs(config.plan.limit_ms, 0)} or ${config.plan.max_error_rate_pct}% of its answers fail. p50, p95, p99: half, 95% and 99% of the answers were faster than this.`}
            />
          }
        >
          <DataTable
            aria-label="Levels"
            variant="embedded"
            stripe="report"
            columns={levelColumns()}
            rows={rows}
            rowKey={(r) => r.level}
            rowProps={(r) => ({ 'data-performance-level-row': String(r.level) })}
            responsive="scroll"
            fit="declared"
            stickyHeader={false}
            minWidth={1122}
          />
        </Card>
      ) : null}
    </div>
  );
}
