import { Link } from 'react-router-dom';
import type { LiveFilters, LiveMetricSpec, LiveTurnRow, LiveTurnsPage } from '@/api/live';
import { formatHeaderDate, formatTableDate } from '@/lib/dates';
import { formatDuration, formatPercentValue } from '@/lib/format';
import { textDirAttrs } from '@/lib/text';
import { applyQueryUpdates, useSearchParamsState } from '@/lib/url-state';
import {
  DataTable,
  EmptyState,
  KeyValueGrid,
  ScoreValue,
  StatusMark,
  Tag,
  type Column,
  type SortState,
  type TagTone,
} from '@/ui';
import { listedScoreColumns } from '../lib/filters';
import { diagnosisSpec, mixSegments, verdictOf } from '../lib/mix';
import { PassFailTag } from './turn/Evidence';
import styles from '../turns.module.css';

interface TurnsTableProps {
  zone?: string;
  slug: string;
  source: string;
  filters: LiveFilters;
  data: LiveTurnsPage;
  specs: LiveMetricSpec[];
  refreshing?: boolean;
}

function scoreText(row: LiveTurnRow, spec: LiveMetricSpec): string {
  const score = row.scores[spec.metric_name];
  if (!score || score.skipped) return '—';
  const value = score.score_numeric;
  if (value === null) return score.label ?? '—';
  const digits = spec.precision ?? (spec.score_type === 'numeric' ? 2 : 0);
  if (spec.score_type === 'percentage') return formatPercentValue(value, 1);
  if (spec.score_type === 'boolean') return value ? 'Pass' : 'Fail';
  return `${value.toFixed(digits)}${spec.unit ? (['s', 'ms', 'min', 'h'].includes(spec.unit) ? spec.unit : ` ${spec.unit}`) : ''}`;
}

function turnScore(row: LiveTurnRow, spec: LiveMetricSpec) {
  const score = row.scores[spec.metric_name];
  const value = score?.skipped ? null : score?.score_numeric;
  return spec.score_type === 'boolean' ? (
    <PassFailTag value={value ?? null} />
  ) : (
    <ScoreValue
      value={value}
      direction={spec.direction}
      type={spec.score_type === 'percentage' ? 'score' : spec.score_type}
      text={scoreText(row, spec)}
      variant="plain"
    />
  );
}

function scoreHeader(spec: LiveMetricSpec) {
  if (spec.is_primary) return 'Success';
  if (spec.metric_name === 'compliance_a') return 'Judge A';
  if (spec.metric_name === 'compliance_b') return 'Judge B';
  return spec.label;
}

export function TurnsTable({ slug, source, filters, data, specs, refreshing }: TurnsTableProps) {
  const { params, replaceUrlQuery } = useSearchParamsState();
  const path = `/projects/${encodeURIComponent(slug)}/live/turns`;
  const linkTo = (conversation: string) =>
    `${path}?${applyQueryUpdates(params, { source, conversation, day: null, from: null, to: null, page: null })}`;
  const diagnosis = diagnosisSpec(specs);
  const labels = mixSegments(
    Object.fromEntries(data.rows.filter((row) => row.label).map((row) => [row.label!, 1])),
    diagnosis,
  );
  const labelFor = (value: string | null) => labels.find((label) => label.value === value);
  // Layout A keeps three scores in the scan row; the remaining returned scores are in its details.
  const listed = listedScoreColumns(specs);
  const scoreColumns = listed.slice(0, 3);
  const columnNames = new Set(scoreColumns.map((spec) => spec.metric_name));
  const remainingScores = specs.filter(
    (spec) => spec.score_type !== 'categorical' && !columnNames.has(spec.metric_name),
  );
  const problems = (row: LiveTurnRow) => [
    ...row.services_not_ok.map((service) => {
      const tone =
        labelFor(service.fault)?.tone ??
        labelFor(service.fault ? `${service.fault}_problem` : null)?.tone ??
        'neutral';
      return {
        key: service.name,
        label: `${(specs.find((spec) => spec.metric_name === `service.${service.name}`)?.label ?? service.name).replace(/\b(sql|api|url|id)\b/gi, (word) => word.toUpperCase())}${service.fault ? ` · ${service.fault}` : ''}`,
        tone: tone === 'neutral' ? undefined : (tone as TagTone),
      };
    }),
    ...(row.charts.failed
      ? [
          {
            key: 'charts-failed',
            label: `${row.charts.failed} chart${row.charts.failed === 1 ? '' : 's'} failed`,
            tone: 'danger' as const,
          },
        ]
      : []),
  ];
  const problemTags = (row: LiveTurnRow, compact = false) => {
    const all = problems(row);
    const shown = compact ? all.slice(0, 2) : all;
    const tag = (problem: (typeof all)[number]) => (
      <Tag
        key={problem.key}
        tone={problem.tone}
        title={problem.label}
        className={styles.problemTag}
        data-live-problem-tag
      >
        <span
          {...textDirAttrs(problem.label)}
          className={styles.problemText}
          data-compact={compact || undefined}
        >
          {problem.label}
        </span>
      </Tag>
    );
    return (
      <div className={compact ? styles.problems : styles.allProblems}>
        {shown.length ? (
          shown.map((problem, index) =>
            compact && index === 1 && all.length > 2 ? (
              <span className={styles.problemTail} key={problem.key}>
                {tag(problem)}
                <span className={styles.moreProblems} title={all.map((item) => item.label).join('\n')}>
                  +{all.length - 2} more
                </span>
              </span>
            ) : (
              tag(problem)
            ),
          )
        ) : (
          <span className={styles.muted}>None</span>
        )}
      </div>
    );
  };
  const sort = filters.sort ?? '-turn_at';
  const sortState: SortState = {
    key: sort.replace(/^-/, ''),
    direction: sort.startsWith('-') ? 'desc' : 'asc',
  };
  const columns: Column<LiveTurnRow>[] = [
    {
      id: 'turn_at',
      header: 'Time',
      width: 120,
      pin: 'start',
      sort: { key: 'turn_at', first: 'desc' },
      cell: (row) => (
        <time className={styles.time} dateTime={row.turn_at} title={formatHeaderDate(row.turn_at)}>
          {formatTableDate(row.turn_at)}
        </time>
      ),
    },
    {
      id: 'question',
      header: 'Question',
      flex: true,
      minWidth: 240,
      primary: true,
      cell: (row) => (
        <div
          {...textDirAttrs(row.question)}
          title={row.question}
          className={styles.question}
          data-live-question
        >
          {row.question}
        </div>
      ),
    },
    {
      id: 'label',
      header: 'Diagnosis',
      width: 220,
      cell: (row) => {
        const label = labelFor(row.label);
        const v = verdictOf(label?.specTone);
        return (
          <div className={styles.diagnosisCell}>
            <StatusMark
              tone={v.tone}
              shape={v.tone === 'danger' ? 'cross' : v.tone === 'neutral' ? 'ring' : 'full'}
              label={label?.label ?? row.label ?? '—'}
            />
            {row.label_reason ? (
              <div className={styles.reason} {...textDirAttrs(row.label_reason)} title={row.label_reason}>
                {row.label_reason}
              </div>
            ) : null}
          </div>
        );
      },
    },
    ...scoreColumns.map((spec): Column<LiveTurnRow> => ({
      id: `metric:${spec.metric_name}`,
      header: scoreHeader(spec),
      label: spec.label,
      hint: spec.label,
      width: 88,
      align: 'end',
      mono: true,
      sort: { key: `metric:${spec.metric_name}`, first: 'desc' },
      cell: (row) => turnScore(row, spec),
    })),
    {
      id: 'latency_ms',
      header: 'Latency',
      width: 88,
      align: 'end',
      mono: true,
      sort: { key: 'latency_ms', first: 'desc' },
      cell: (row) => (
        <span data-live-latency={row.latency_ms ?? undefined}>
          {row.latency_ms === null
            ? '—'
            : row.latency_ms >= 1000 && row.latency_ms < 60_000
              ? `${Math.round(row.latency_ms / 1000)}s`
              : formatDuration(row.latency_ms)}
        </span>
      ),
    },
    { id: 'problems', header: 'Problems', width: 220, cell: (row) => problemTags(row, true) },
    {
      id: 'turn',
      header: 'Turn',
      width: 64,
      align: 'end',
      mono: true,
      cell: (row) =>
        row.conversation_id ? (
          <Link
            data-link="name"
            to={linkTo(row.conversation_id)}
            title={row.conversation_id}
            aria-label={`Conversation ${row.conversation_id}${row.turn_index === null ? '' : ` · turn ${row.turn_index + 1}`}`}
          >
            {row.turn_index === null ? '—' : row.turn_index + 1}
          </Link>
        ) : row.turn_index === null ? (
          '—'
        ) : (
          row.turn_index + 1
        ),
    },
  ];

  return (
    <div data-live-block="turns-table" className={styles.table}>
      <DataTable
        aria-label="Live turns"
        cellAlign="first-line"
        rows={data.rows}
        columns={columns}
        rowKey={(row) => row.turn_id}
        rowHref={(row) =>
          `${path}/${encodeURIComponent(row.turn_id)}?${new URLSearchParams({ source, list: params.toString() })}`
        }
        rowProps={(row) => ({ 'data-live-turn-row': row.turn_id })}
        renderExpanded={(row) => (
          <div className={styles.details} data-live-turn-details>
            <KeyValueGrid
              columns={1}
              items={[
                {
                  key: 'reason',
                  label: 'Why this diagnosis',
                  value: (
                    <div {...textDirAttrs(row.label_reason)} className={styles.detailText}>
                      {row.label_reason ?? '—'}
                    </div>
                  ),
                },
              ]}
            />
            <KeyValueGrid
              columns={4}
              items={[
                ...remainingScores
                  .filter((spec) => Object.hasOwn(row.scores, spec.metric_name))
                  .map((spec) => ({
                    key: spec.metric_name,
                    label: spec.label,
                    value: turnScore(row, spec),
                  })),
                {
                  key: 'charts',
                  label: 'Charts',
                  value: (
                    <span className={styles.number}>
                      {row.charts.count}
                      {row.charts.failed ? (
                        <span data-tone="danger" className={styles.toneText}>
                          {' '}
                          · {row.charts.failed} failed
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: 'mode',
                  label: 'Mode',
                  value: row.mode ? (
                    <Tag kind="data">
                      <span {...textDirAttrs(row.mode)} className={styles.detailText}>
                        {row.mode}
                      </span>
                    </Tag>
                  ) : (
                    '—'
                  ),
                },
                {
                  key: 'user',
                  label: 'User',
                  value: (
                    <div {...textDirAttrs(row.user_ref)} className={styles.detailText}>
                      {row.user_ref ?? '—'}
                    </div>
                  ),
                  mono: true,
                },
              ]}
            />
            <KeyValueGrid
              columns={2}
              items={[
                {
                  key: 'conversation',
                  label: 'Conversation',
                  value: row.conversation_id ? (
                    <Link data-link="name" className={styles.number} to={linkTo(row.conversation_id)}>
                      <div {...textDirAttrs(row.conversation_id)} className={styles.detailText}>
                        {row.conversation_id}
                      </div>
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                {
                  key: 'services',
                  label: 'Services not OK',
                  value: problemTags({ ...row, charts: { ...row.charts, failed: 0 } }),
                },
              ]}
            />
          </div>
        )}
        sort={sortState}
        onSortChange={(next) =>
          replaceUrlQuery({
            sort: next ? `${next.direction === 'desc' ? '-' : ''}${next.key}` : null,
            page: null,
          })
        }
        refreshing={refreshing}
        responsive="scroll"
        fit="declared"
        empty={<EmptyState title="No turns match" body="Try removing a filter or changing the search." />}
      >
        <DataTable.Footer
          pagination={{
            total: data.total,
            page: filters.page ?? 1,
            pageSize: 50,
            noun: 'turns',
            onPageChange: (page) => replaceUrlQuery({ page: page === 1 ? null : page }),
          }}
        />
      </DataTable>
    </div>
  );
}
