/** Task 10: composed, static Live pages. No API calls; fixtures are reusable by the feature tasks. */
import type { ReactNode } from 'react';
import type { LiveOverview, LiveTurnRow } from '@/api/live';
import {
  Button,
  Card,
  Chip,
  CopyButton,
  DataTable,
  DateTimeField,
  Disclosure,
  EmptyState,
  Icon,
  IconButton,
  KeyValueGrid,
  LinkButton,
  PageHeader,
  Popover,
  QuickFilterGroup,
  ScoreValue,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Select,
  StatTiles,
  StatusMark,
  TabPanel,
  Tabs,
  Tag,
  Text,
  type CardTone,
  type Column,
  type IconName,
  type StatTile,
} from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { ChartCard } from '@/features/run-detail/components/charts/ChartCard';
import { BarColumns, type BarSpec } from '@/features/run-detail/components/charts/Charts';
import { ChartImage } from '@/features/live/components/turn/ChartImage';
import { chartsOf } from '@/features/live/lib/summary';
import {
  liveDay,
  liveDiagnosisSpec,
  liveOverview,
  liveSpecs,
  liveTurnDetail,
  liveTurnEvidence,
  liveTurnsPage,
} from './liveFixtures';
import styles from './LiveMocks.module.css';

const noop = () => undefined;
const turn = liveTurnDetail.turn;
const evidence = liveTurnEvidence;
const labels = liveDiagnosisSpec.values;
const labelFor = (value: string | null) => labels.find((label) => label.value === value) ?? labels[5]!;
const toneFor = (value: string): CardTone => {
  switch (value) {
    case 'accent':
    case 'warning':
    case 'danger':
    case 'meta':
      return value;
    default:
      return 'neutral';
  }
};
const TONE_FILL: Partial<Record<CardTone, string>> = {
  accent: 'var(--accent-primary)',
  warning: 'var(--warning)',
  danger: 'var(--error)',
  meta: 'var(--accent-tertiary)',
  neutral: 'var(--text-muted)',
};
const turnsUrl = (filters: Record<string, string> = {}) =>
  `/projects/demo/live/turns?${new URLSearchParams({ source: liveOverview.status.key, day: liveDay, ...filters })}`;
const detailUrl = (id: string) => `/projects/demo/live/turns/${id}?source=${liveOverview.status.key}`;
const clockTime = (at: string) => at.slice(11, 16);
function Quantity({ value, unit }: { value: number; unit: string }) {
  return (
    <span className={styles.quantity}>
      <span className={styles.number}>{value}</span> {unit}
    </span>
  );
}

const duration = (ms: number | null) =>
  ms === null ? '—' : <Quantity value={Math.round(ms / 1000)} unit="s" />;
const metricLabel = (name: string) => liveSpecs.find((spec) => spec.metric_name === name)?.label ?? name;
const userText = (text: string | null, className?: string) => (
  <span dir="auto" className={className}>
    {text ?? '—'}
  </span>
);

const NAV: [IconName, string][] = [
  ['home', 'Dashboard'],
  ['clock', 'Live'],
  ['chart', 'Charts'],
  ['list', 'Runs'],
  ['folder', 'Models'],
  ['flask', 'Experiments'],
  ['sparkles', 'Auto-analysis'],
  ['review', 'Reviews'],
  ['database', 'Datasets'],
  ['settings', 'Project settings'],
];

function Shell({ page, children }: { page: 'overview' | 'turns' | 'turn'; children: ReactNode }) {
  return (
    <div className={styles.shell} data-live-mock={page} id={`live-${page}`}>
      <aside className={styles.sidebar} aria-label="Project navigation">
        <div className={styles.brand}>qym</div>
        <nav className={styles.nav}>
          <span className={styles.navItem}>
            <Icon name="folder" size={14} />
            <span>Projects</span>
          </span>
          <span className={styles.navItem}>
            <Icon name="book" size={14} />
            <span>Docs</span>
          </span>
          <Text variant="sm" tone="muted" className={styles.project}>
            Demo
          </Text>
          {NAV.map(([icon, label]) => (
            <span
              key={label}
              className={styles.navItem}
              data-active={label === 'Live' ? '' : undefined}
              aria-current={label === 'Live' ? 'page' : undefined}
            >
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </span>
          ))}
        </nav>
        <div className={styles.user}>
          <Tag kind="data">DU</Tag>
          <span>Dev User</span>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.topbar}>
          <Icon name="sidebar" size={14} />
          <span className={styles.inline}>
            Demo <Icon name="chevron-right" size={12} /> Live
            {page !== 'overview' ? (
              <>
                <Icon name="chevron-right" size={12} /> Turns
              </>
            ) : null}
            {page === 'turn' ? (
              <>
                <Icon name="chevron-right" size={12} />
                <span className={styles.number}>09:12</span>
              </>
            ) : null}
          </span>
        </div>
        <main className={styles.content} data-live-block="content">
          {children}
        </main>
      </div>
    </div>
  );
}

function SourceMeta() {
  return (
    <span className={styles.inline} data-live-block="source">
      <Select
        label="Live source"
        hideLabel
        items={[
          { key: 'worker-preprod', label: 'Evaluation worker' },
          { key: 'worker-staging', label: 'Staging worker' },
        ]}
        value="worker-preprod"
        onChange={noop}
      />
      <Tag kind="data" dir="auto">
        {liveOverview.status.environment}
      </Tag>
    </span>
  );
}

function DaySwitcher() {
  return (
    <span className={styles.inline} data-live-block="day-switcher">
      <IconButton label="Previous day" icon="prev" onPress={noop} />
      <Popover label="Choose day" trigger={<Button>Today · 1 Nov 2026</Button>}>
        <DateTimeField label="Day (UTC)" value={liveDay} onChange={noop} />
      </Popover>
      <IconButton label="Next day" icon="next" isDisabled />
      <Text variant="sm" tone="muted">
        UTC
      </Text>
    </span>
  );
}

function WorkerStatus({ stale = false }: { stale?: boolean }) {
  const worker = liveOverview.status.worker;
  return (
    <Card
      compact
      tone={stale ? 'danger' : undefined}
      wash={stale ? 'danger' : undefined}
      data-live-block={stale ? 'status-stale' : 'status'}
    >
      <div className={styles.status} data-stale={stale ? '' : undefined}>
        <StatusMark
          tone={stale ? 'danger' : 'success'}
          data-tone={stale ? 'danger' : 'accent'}
          shape={stale ? 'cross' : 'orbit'}
          label={stale ? 'Stale' : 'Running'}
        />
        <span>
          {stale ? (
            'Worker not heard from since 08:42 UTC'
          ) : (
            <>
              Last poll <Quantity value={12} unit="s" /> ago
            </>
          )}
        </span>
        <span>
          Last turn <span className={styles.number}>09:12 UTC</span>
        </span>
        <span className={styles.inline}>
          Judges <Tag kind="data">judge-a</Tag>
          <Tag kind="data">judge-b</Tag>
        </span>
        <Tag kind="version" dir="auto">
          {String(worker.eval_code_version)}
        </Tag>
        <Tag kind="version" dir="auto">
          {String(worker.manifest_hash)}
        </Tag>
      </div>
    </Card>
  );
}

function Tiles({ items, label }: { items: StatTile[]; label: string }) {
  return (
    <div className={styles.tiles} data-live-block="stats">
      <StatTiles
        aria-label={label}
        items={items.map((item) => ({
          ...item,
          help: item.meaning,
          value: <span data-live-stat={item.key}>{item.value}</span>,
        }))}
      />
    </div>
  );
}

function Mix({
  counts,
  compact = false,
  day = liveDay,
}: {
  counts: Record<string, number>;
  compact?: boolean;
  day?: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <ChartTooltipHost className={styles.mix} data-live-block={compact ? 'day-mix' : 'mix-plot'}>
      {labels.map((label) => (
        <Mark
          key={label.value}
          as="button"
          tone={toneFor(label.tone)}
          className={styles.mixSegment}
          style={{ flex: counts[label.value] ?? 0 }}
          data-live-label={label.value}
          tip={`${label.label}: ${counts[label.value] ?? 0} of ${total} turns`}
          aria-label={`${label.label}: ${counts[label.value] ?? 0} turns`}
          onPick={() => window.location.assign(turnsUrl({ day, label: label.value }))}
        />
      ))}
    </ChartTooltipHost>
  );
}

function Overview() {
  const problemLabels = labels
    .filter((label) => ['danger', 'warning'].includes(label.tone))
    .sort((a, b) => (liveOverview.day.label_mix[b.value] ?? 0) - (liveOverview.day.label_mix[a.value] ?? 0))
    .slice(0, 2);
  const stats: StatTile[] = [
    {
      key: 'turns',
      label: 'Turns',
      value: <a href={turnsUrl()}>47</a>,
      meaning: '47 real user turns seen by the worker today.',
    },
    {
      key: 'evaluated',
      label: 'Evaluated',
      value: <a href={turnsUrl({ status: 'completed' })}>44</a>,
      meaning: '44 turns evaluated; 3 still have incomplete evidence.',
    },
    {
      key: 'primary',
      label: metricLabel(liveOverview.primary_metric!),
      value: <a href={turnsUrl({ metric: 'agent_success', min: '0.5' })}>71%</a>,
      band: 3,
      meaning: '25 of 35 scored turns pass Agent success. Skipped scores are excluded.',
    },
    ...problemLabels.map((label) => ({
      key: label.value,
      label: label.label,
      value: (
        <a data-tone={label.tone} className={styles.toneText} href={turnsUrl({ label: label.value })}>
          {liveOverview.day.label_mix[label.value]}
        </a>
      ),
      meaning: `Turns diagnosed as ${label.label.toLowerCase()} today.`,
    })),
    {
      key: 'latency',
      label: 'Median latency',
      value: <a href={turnsUrl({ sort: 'latency_desc' })}>{duration(liveOverview.day.latency.median_ms)}</a>,
      meaning: 'Median response latency. P90: 214 s; 3 turns took more than 5 minutes.',
    },
  ];
  return (
    <>
      <div data-live-block="header">
        <PageHeader
          title="Live evaluation"
          description="Every real user turn, evaluated as it happens"
          meta={[<SourceMeta key="source" />, <DaySwitcher key="day" />]}
        />
      </div>
      <WorkerStatus />
      <Tiles items={stats} label="Day numbers" />
      <div className={styles.mixRow}>
        <Card
          data-live-block="mix"
          header={
            <Text variant="md" weight={600}>
              Diagnosis mix
            </Text>
          }
        >
          <Mix counts={liveOverview.day.label_mix} />
          <div className={styles.mixLegend}>
            {labels.map((label) => (
              <a
                key={label.value}
                href={turnsUrl({ label: label.value })}
                className={styles.legendItem}
                data-tone={label.tone}
              >
                <span className={styles.swatch} aria-hidden="true" />
                <span dir="auto">{label.label}</span>
                <strong className={styles.number}>{liveOverview.day.label_mix[label.value]}</strong>
              </a>
            ))}
          </div>
          <Text variant="sm" tone="muted" className={styles.received} data-live-block="ingest-gap">
            {liveOverview.day.not_in_qym > 0
              ? `${liveOverview.day.not_in_qym} turns not yet in qym`
              : 'All 47 turns received in qym · 3 awaiting complete evaluation'}
          </Text>
        </Card>
        <Card
          data-live-block="means"
          header={
            <Text variant="md" weight={600}>
              Metric means
            </Text>
          }
        >
          <ChartTooltipHost className={styles.metricRows}>
            {liveOverview.day.metric_means.map((metric) => (
              <div
                key={metric.metric_name}
                className={styles.metricRow}
                data-live-metric={metric.metric_name}
              >
                <span dir="auto">{metric.spec.label}</span>
                <Mark tip={`${metric.n} non-skipped scores`}>
                  <ScoreValue value={metric.mean} direction={metric.spec.direction} variant="plain" />
                </Mark>
              </div>
            ))}
          </ChartTooltipHost>
        </Card>
      </div>
      <Card
        data-live-block="services"
        header={
          <Text variant="md" weight={600}>
            Service health
          </Text>
        }
      >
        <div className={styles.services}>
          {liveOverview.day.services.map((service) => (
            <a
              key={service.name}
              data-live-service={service.name}
              href={turnsUrl({ service: service.name, service_status: 'not_ok' })}
              className={styles.service}
            >
              <ScoreValue value={service.ok_rate} direction="higher" variant="plain" />
              <span dir="auto">{metricLabel(`service.${service.name}`)}</span>
            </a>
          ))}
        </div>
        <div className={styles.canaries} data-live-block="canaries">
          <Text variant="sm" tone="muted">
            Canaries
          </Text>
          {[...liveOverview.canaries]
            .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'))
            .map((probe) => (
              <span key={probe.canary} className={styles.inline} data-live-canary={probe.canary}>
                <StatusMark
                  tone={probe.status === 'failed' ? 'danger' : 'success'}
                  shape={probe.status === 'failed' ? 'cross' : 'check'}
                  label={`${metricLabel(`service.${probe.canary}`)} ${probe.status}`}
                />
                <span className={styles.number}>{probe.latency_ms} ms</span>
              </span>
            ))}
        </div>
      </Card>
      <Trend />
      <div data-live-block="days">
        <DataTable
          aria-label="Days"
          columns={dayColumns}
          rows={liveOverview.days.rows}
          rowKey={(row) => row.day}
          rowHref={(row) => turnsUrl({ day: row.day })}
          rowProps={(row) => ({ 'data-live-day': row.day })}
          responsive="scroll"
          minWidth={850}
        >
          <DataTable.Toolbar
            count={
              <Text variant="md" weight={600}>
                Days
              </Text>
            }
          />
          <DataTable.Footer
            pagination={{ total: 7, page: 1, pageSize: 30, noun: 'days', onPageChange: noop }}
          />
        </DataTable>
      </div>
    </>
  );
}

function stackedFill(counts: Record<string, number>) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let start = 0;
  return `linear-gradient(to top, ${labels
    .map((label) => {
      const end = start + ((counts[label.value] ?? 0) / Math.max(total, 1)) * 100;
      const stop = `${TONE_FILL[toneFor(label.tone)]} ${start}% ${end}%`;
      start = end;
      return stop;
    })
    .join(', ')})`;
}

function Trend() {
  const bars: BarSpec[] = liveOverview.trend.map((day) => ({
    key: day.day,
    count: day.turns,
    label: day.day.slice(8),
    zero: day.worker_gap ? 'hide' : 'show',
    color: day.worker_gap
      ? 'repeating-linear-gradient(135deg, var(--border-strong) 0 var(--space-xs), var(--bg-elevated) var(--space-xs) var(--space-sm))'
      : stackedFill(day.counts_by_label),
    name: `${day.day}: ${day.worker_gap ? 'worker gap, no heartbeat' : `${day.turns} turns, ${Math.round((day.primary_rate ?? 0) * 100)}% agent success`}`,
    tip: (
      <div>
        <strong>{day.day}</strong>
        {day.worker_gap ? (
          <p>Worker gap · no heartbeat all day</p>
        ) : (
          <>
            <p>
              {day.turns} turns · {Math.round((day.primary_rate ?? 0) * 100)}% agent success
            </p>
            {labels.map((label) => (
              <div key={label.value}>
                {label.label}: {day.counts_by_label[label.value] ?? 0}
              </div>
            ))}
          </>
        )}
      </div>
    ),
    onPick: () => window.location.assign(`/projects/demo/live?source=worker-preprod&day=${day.day}`),
    data: { 'data-live-trend-day': day.day, 'data-live-gap': day.worker_gap ? 'true' : 'false' },
  }));
  // Separate segments leave a genuine break across the missing day. The line has its own 0–100% scale.
  const paths = [liveOverview.trend.slice(0, 6), liveOverview.trend.slice(7)].map((days, part) =>
    days
      .map(
        (day, i) =>
          `${i ? 'L' : 'M'} ${((i + (part ? 7 : 0) + 0.5) / 14) * 100} ${100 - (day.primary_rate ?? 0) * 100}`,
      )
      .join(' '),
  );
  return (
    <ChartCard
      title="Turns over time"
      data-live-block="trend"
      legend={
        <span className={styles.inline}>
          <span className={styles.lineKey} />
          Agent success · 0–100%
        </span>
      }
      controls={
        <SegmentedControl
          label="Trend period"
          options={[
            { value: '14', label: '14 days' },
            { value: '30', label: '30' },
            { value: '90', label: '90' },
          ]}
          value="14"
          onChange={noop}
        />
      }
      caption="19 Oct – 1 Nov · UTC · hatched column: worker gap"
    >
      <ChartTooltipHost className={styles.trendPlot} data-live-block="trend-plot">
        <BarColumns bars={bars} name="Daily turns by diagnosis and Agent success" />
        <svg className={styles.rateLine} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {paths.map((d) => (
            <Mark as="path" key={d} d={d} />
          ))}
        </svg>
      </ChartTooltipHost>
    </ChartCard>
  );
}

const dayColumns: Column<LiveOverview['days']['rows'][number]>[] = [
  { id: 'day', header: 'Day (UTC)', width: 130, mono: true },
  { id: 'turns_seen', header: 'Turns', width: 75, type: 'number' },
  { id: 'evaluated', header: 'Evaluated', width: 90, type: 'number' },
  { id: 'failed', header: 'Failed', width: 75, type: 'number' },
  {
    id: 'primary_rate',
    header: 'Agent success',
    width: 120,
    cell: (row) => <ScoreValue value={row.primary_rate} direction="higher" variant="plain" />,
  },
  {
    id: 'mix',
    header: 'Diagnosis mix',
    minWidth: 180,
    flex: true,
    cell: (row) => <Mix compact counts={row.label_mix} day={row.day} />,
  },
  {
    id: 'worker',
    header: 'Worker',
    width: 110,
    cell: (row) => (
      <StatusMark
        tone={row.worker_gap ? 'danger' : row.status === 'running' ? 'success' : 'neutral'}
        shape={row.worker_gap ? 'cross' : row.status === 'running' ? 'orbit' : 'full'}
        label={row.worker_gap ? 'Stale' : row.status}
      />
    ),
  },
];

const turnColumns: Column<LiveTurnRow>[] = [
  {
    id: 'turn_at',
    header: 'Time (UTC)',
    width: 88,
    pin: 'start',
    mono: true,
    sort: 'turn_at',
    cell: (row) => clockTime(row.turn_at),
  },
  {
    id: 'question',
    header: 'Question',
    width: 260,
    cell: (row) => (
      <span dir="auto" title={row.question} className={styles.question} data-live-question>
        {row.question}
      </span>
    ),
  },
  {
    id: 'mode',
    header: 'Mode',
    width: 90,
    cell: (row) => (
      <Tag kind="data" dir="auto">
        {row.mode}
      </Tag>
    ),
  },
  {
    id: 'label',
    header: 'Diagnosis',
    width: 200,
    cell: (row) => (
      <span className={styles.diagnosisCell} title={row.label_reason ?? undefined}>
        <Diagnosis value={row.label} />
        <span className={styles.reason} dir="auto" title={row.label_reason ?? undefined}>
          {row.label_reason}
        </span>
      </span>
    ),
  },
  ...['agent_success', 'compliance_a', 'compliance_b'].map((name): Column<LiveTurnRow> => ({
    id: name,
    header: metricLabel(name),
    width: 108,
    sort: name,
    align: 'end',
    cell: (row) => <ScoreValue value={row.scores[name]?.score_numeric} direction="higher" variant="plain" />,
  })),
  {
    id: 'latency_ms',
    header: 'Latency',
    width: 88,
    sort: 'latency_ms',
    mono: true,
    cell: (row) => duration(row.latency_ms),
  },
  {
    id: 'charts',
    header: 'Charts',
    width: 100,
    cell: (row) => (
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
    id: 'services',
    header: 'Services not OK',
    width: 150,
    cell: (row) =>
      row.services_not_ok.map((service) => (
        <span
          key={service.name}
          className={styles.serviceFault}
          data-tone={labelFor(service.fault ? `${service.fault}_problem` : null).tone}
          dir="auto"
        >
          {service.name} · {service.fault}
        </span>
      )),
  },
  {
    id: 'user',
    header: 'User · conversation',
    width: 180,
    cell: (row) => (
      <span className={styles.diagnosisCell}>
        {userText(row.user_ref, styles.number)}
        <a
          className={styles.number}
          href={turnsUrl({ conversation: row.conversation_id! })}
          title={row.conversation_id ?? undefined}
        >
          conversation {row.conversation_id?.slice(-3)} · turn {(row.turn_index ?? 0) + 1}
        </a>
      </span>
    ),
  },
];

function Diagnosis({ value }: { value: string | null }) {
  const label = labelFor(value);
  return (
    <StatusMark
      tone="neutral"
      data-tone={label.tone}
      shape={label.tone === 'danger' ? 'cross' : label.tone === 'accent' ? 'check' : 'ring'}
      label={label.label}
    />
  );
}

function Turns() {
  return (
    <>
      <div data-live-block="header">
        <PageHeader
          title="Turns"
          description="6 of 47 turns on 1 Nov 2026"
          meta={[<SourceMeta key="source" />]}
          actions={
            <span data-live-block="export">
              <Button icon={<Icon name="download" size={14} />}>Export CSV</Button>
            </span>
          }
        />
      </div>
      <div className={styles.filters} data-live-block="filters">
        <QuickFilterGroup
          label="Day (UTC)"
          mode="single"
          options={[{ id: liveDay, label: '1 Nov 2026', count: 47 }]}
          selected={[liveDay]}
          onToggle={noop}
        />
        <div className={styles.filterLabel}>
          <Text variant="sm" tone="muted" weight={650}>
            Diagnosis
          </Text>
          <Chip
            isSelected
            tone={toneFor(labelFor('agent_problem').tone)}
            count={6}
            onChange={noop}
            onRemove={noop}
          >
            Agent problem
          </Chip>
        </div>
        <SearchField
          label="Search questions and answers"
          placeholder="Search question or answer"
          className={styles.search}
        />
      </div>
      <div data-live-block="turns-table">
        <DataTable
          aria-label="Live turns"
          rows={liveTurnsPage.rows}
          columns={turnColumns}
          rowKey={(row) => row.turn_id}
          rowHref={(row) => detailUrl(row.turn_id)}
          rowProps={(row) => ({ 'data-live-turn-row': row.turn_id })}
          sort={{ key: 'turn_at', direction: 'desc' }}
          onSortChange={noop}
          responsive="scroll"
          fit="declared"
          minWidth={1600}
        >
          <DataTable.Footer
            pagination={{
              total: liveTurnsPage.total,
              page: 1,
              pageSize: 50,
              noun: 'turns',
              onPageChange: noop,
            }}
          />
        </DataTable>
      </div>
    </>
  );
}

function Sql({ parts }: { parts: Record<string, unknown>[] }) {
  return (
    <div className={styles.sqlParts}>
      {parts.map((part, i) => (
        <div key={i}>
          <div className={styles.sqlMeta}>
            <StatusMark
              tone={part.executed ? 'success' : 'warning'}
              shape={part.executed ? 'check' : 'pause'}
              label={part.executed ? 'Executed' : 'Not executed'}
            />
            <span className={styles.number}>{String(part.rows ?? '—')} rows</span>
            <CopyButton text={String(part.text)} label="Copy SQL" />
          </div>
          <pre className={styles.sql} dir="ltr">
            <code>{String(part.text)}</code>
          </pre>
          {part.error ? (
            <Text variant="base" tone="danger">
              {String(part.error)}
            </Text>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Turn() {
  const label = labelFor(turn.label);
  const score = (name: string) => liveTurnDetail.scores.find((s) => s.metric_name === name)?.score_numeric;
  const tile = (key: string): StatTile => ({
    key,
    label: metricLabel(key),
    value: <ScoreValue value={score(key)} direction="higher" variant="plain" />,
    meaning: `This turn's ${metricLabel(key).toLowerCase()} score; skipped values show a dash.`,
  });
  return (
    <>
      <div data-live-block="header">
        <PageHeader
          title={
            <span className={styles.turnTitle} dir="auto" data-live-question>
              {turn.question}
            </span>
          }
          meta={[
            <span key="time" className={styles.number}>
              1 Nov 2026 · 09:12 UTC
            </span>,
            userText(turn.user_ref),
            <span key="conversation">
              conversation 001 · turn{' '}
              <span className={styles.number}>
                {(turn.turn_index ?? 0) + 1} of {liveTurnDetail.conversation.length}
              </span>
            </span>,
            <Tag key="mode" kind="data" dir="auto">
              {turn.mode}
            </Tag>,
            <Tag key="env" kind="data" dir="auto">
              {liveOverview.status.environment}
            </Tag>,
            <a key="trace" href={turn.trace_url!}>
              Product trace ↗
            </a>,
            <a key="eval" href={turn.eval_trace_url!}>
              Evaluation trace ↗
            </a>,
          ]}
          actions={
            <span className={styles.inline} data-live-block="turn-navigation">
              <IconButton label="Previous turn" icon="prev" isDisabled />
              <IconButton label="Next turn" icon="next" onPress={noop} />
            </span>
          }
        />
        <Card compact tone={toneFor(label.tone)} data-live-block="diagnosis-label">
          <div className={styles.inline}>
            <Diagnosis value={turn.label} />
            <span dir="auto">{turn.label_reason}</span>
          </div>
        </Card>
      </div>
      <Tiles
        label="Turn numbers"
        items={[
          tile('agent_success'),
          tile('compliance_a'),
          tile('compliance_b'),
          {
            key: 'latency',
            label: 'Latency',
            value: duration(turn.latency_ms),
            meaning: 'Elapsed response time for this turn.',
          },
          {
            key: 'rows',
            label: 'Result rows',
            value: turn.result_rows,
            meaning: 'Rows returned by the agent SQL.',
          },
          {
            key: 'charts',
            label: 'Charts',
            value: evidence.charts.length,
            meaning: 'One chart produced; one failed validation.',
          },
        ]}
      />
      <div data-live-block="tabs">
        <Tabs
          label="Turn sections"
          selected="diagnosis"
          onSelect={noop}
          items={[
            { id: 'diagnosis', label: 'Diagnosis' },
            { id: 'answer', label: 'Answer and SQL' },
            { id: 'judges', label: 'Judges' },
            { id: 'charts', label: 'Charts' },
            { id: 'services', label: 'Services and tools' },
            { id: 'conversation', label: 'Conversation' },
            { id: 'evaluator', label: 'Evaluator' },
          ]}
        >
          <TabPanel id="diagnosis" className={styles.diagnosis}>
            <div className={styles.twoColumns}>
              <Card
                data-live-card="why"
                header={
                  <Text variant="md" weight={600}>
                    Why {label.label}
                  </Text>
                }
              >
                <p className={styles.copy} dir="auto">
                  {turn.label_reason}
                </p>
                <KeyValueGrid
                  columns={1}
                  dense
                  items={[
                    ...Object.entries(evidence.judges).map(([key, judge]) => ({
                      key,
                      label: `Judge ${key.toUpperCase()} vs agent`,
                      value: `${judge.vs_agent.equivalent ? 'Equivalent' : 'Not equivalent'} · ${judge.vs_agent.result_set_match ? 'results match' : 'results differ'}`,
                    })),
                    { key: 'agreement', label: 'Judges agree', value: 'Yes' },
                    {
                      key: 'coverage',
                      label: 'Sub-questions covered',
                      value: `${evidence.coverage.covered} / ${evidence.coverage.total}`,
                      mono: true,
                    },
                    { key: 'intent', label: 'Intent', value: userText(evidence.envelope.intent) },
                    {
                      key: 'envelope',
                      label: 'Tool envelope',
                      value: 'Matched · retrieval, sql_execution, visualization',
                    },
                    {
                      key: 'tools',
                      label: 'Tool calls / budget',
                      value: `${evidence.tools.calls} / ${evidence.tools.budget}`,
                      mono: true,
                    },
                  ]}
                />
              </Card>
              <Card
                data-live-card="deviations"
                header={
                  <Text variant="md" weight={600}>
                    Deviations the judges found
                  </Text>
                }
              >
                {Object.keys(evidence.judges).map((judge) => (
                  <div key={judge} className={styles.deviationGroup}>
                    <Text variant="md" weight={600}>
                      Judge {judge.toUpperCase()}
                    </Text>
                    {evidence.deviations
                      .filter((deviation) => deviation.judge === judge)
                      .map((deviation) => (
                        <div key={deviation.axis} className={styles.deviation}>
                          <Tag tone={deviation.axis === 'sql' ? 'danger' : 'warning'}>{deviation.axis}</Tag>
                          <p className={styles.copy} dir="auto">
                            {deviation.text}
                          </p>
                        </div>
                      ))}
                  </div>
                ))}
              </Card>
            </div>
            <div className={styles.twoColumns}>
              <Card
                data-live-card="agent-sql"
                header={
                  <Text variant="md" weight={600}>
                    Agent SQL
                  </Text>
                }
              >
                <Sql parts={turn.sql} />
                <div className={styles.notes}>
                  <span>Not reused by judges</span>
                  <StatusMark tone="success" shape="check" label="Dialect OK" />
                  <StatusMark tone="danger" shape="cross" label="Validator failed" />
                </div>
              </Card>
              <Card
                data-live-card="judge-sql"
                header={
                  <Text variant="md" weight={600}>
                    Judge A SQL
                  </Text>
                }
              >
                <Sql parts={evidence.judges.a.sql_parts} />
                <div data-live-block="judge-b">
                  <Disclosure title="Judge B SQL" summary="1 statement · 1 row">
                    <Sql parts={evidence.judges.b.sql_parts} />
                  </Disclosure>
                </div>
              </Card>
            </div>
            <div className={styles.threeColumns}>
              <Card
                data-live-card="answer"
                header={
                  <Text variant="md" weight={600}>
                    Final answer
                  </Text>
                }
              >
                <p className={styles.answer} dir="auto" data-live-answer>
                  {turn.answer}
                </p>
                <div className={styles.metricRow}>
                  <span>Error detection</span>
                  <ScoreValue value={score('error_detection')} direction="higher" variant="plain" />
                </div>
              </Card>
              <Card
                data-live-card="chart"
                header={
                  <Text variant="md" weight={600}>
                    Chart
                  </Text>
                }
              >
                <ChartImage
                  chart={chartsOf(liveTurnDetail.summary, liveTurnDetail.chart_images)[0]!}
                  size="thumb"
                />
                {Object.entries(evidence.charts[0]!.scores).map(([key, value]) => (
                  <div key={key} className={styles.metricRow}>
                    <span>{metricLabel(key)}</span>
                    <ScoreValue value={value} direction="higher" variant="plain" />
                  </div>
                ))}
                <p className={styles.copy} dir="auto">
                  {evidence.charts[0]!.issues.join(' · ')}
                </p>
              </Card>
              <Card
                data-live-card="turn-services"
                header={
                  <Text variant="md" weight={600}>
                    Services on this turn
                  </Text>
                }
              >
                {Object.entries(evidence.services).map(([name, service]) => (
                  <div key={name} className={styles.metricRow} data-live-turn-service={name}>
                    <span dir="auto">{metricLabel(`service.${name}`)}</span>
                    <span className={styles.inline}>
                      <StatusMark
                        tone={service.status === 'failed' ? 'danger' : 'success'}
                        shape={service.status === 'failed' ? 'cross' : 'check'}
                        label={service.status}
                      />
                      {service.fault ? <Tag tone="danger">{service.fault}</Tag> : null}
                    </span>
                  </div>
                ))}
                <div className={styles.evaluator} data-live-block="evaluator-line">
                  <span>judge-a · judge-b</span>
                  <Tag kind="version">{evidence.eval_meta.eval_code_version}</Tag>
                  <Tag kind="version">{evidence.manifest_hash}</Tag>
                  <span className={styles.number}>
                    Attempt {evidence.eval_meta.attempt} · {evidence.eval_meta.durations.evaluation_ms / 1000}{' '}
                    s
                  </span>
                </div>
              </Card>
            </div>
          </TabPanel>
        </Tabs>
      </div>
    </>
  );
}

export function LiveMocks() {
  return (
    <div className={styles.gallery}>
      <Shell page="overview">
        <Overview />
      </Shell>
      <Shell page="turns">
        <Turns />
      </Shell>
      <Shell page="turn">
        <Turn />
      </Shell>
      <section className={styles.stateSheet} data-live-state="stale">
        <SectionHeader title="Stale worker" description="LV-5 · no heartbeat for more than 300 seconds" />
        <WorkerStatus stale />
      </section>
      <section className={styles.stateSheet} data-live-state="empty">
        <SectionHeader title="No live source" description="LV-1 · successful empty project" />
        <div data-live-block="empty">
          <EmptyState
            title="No live sources yet"
            body="A live source is a worker that evaluates real user turns and sends the results to this project. Connect a worker to see its status, diagnoses and turns here."
            action={<LinkButton to="/docs/platform-guide/live">Read the ingest guide</LinkButton>}
          />
        </div>
      </section>
    </div>
  );
}
