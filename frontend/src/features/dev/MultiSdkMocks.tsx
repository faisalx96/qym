/**
 * Multi-dataset round, WP-C (SDK and run model): composed page mocks of a union run, then the state sheets.
 * Cases: multi-page-run (run detail of a union run), multi-page-runs (runs list), multi-page-compare (compare cards),
 * multi-state-single, multi-state-loading, multi-state-deleted, multi-state-many.
 * The shell is drawn at the real size (1440 wide: sidebar 192, content column 1193) and collapses to the 56 px rail at 390
 * (column 279), like QaPageMocks. The hero reuses the real RunHero.module.css classes, so a band that is not new is the real band.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Chip,
  DatasetTag,
  DataTable,
  Icon,
  IconButton,
  KeyValueTag,
  LinkButton,
  ModelTag,
  ReportSection,
  RunStatusBadge,
  ScoreValue,
  Skeleton,
  StatStrip,
  Tag,
  TaskTag,
  Text,
  type Column,
  type IconName,
} from '@/ui';
import shell from './QaPageMocks.module.css';
import hero from '@/features/run-detail/components/RunHero.module.css';
import nav from '@/features/run-detail/components/SectionNav.module.css';
import styles from './MultiSdkMocks.module.css';

const noop = () => undefined;

const NAV: [IconName, string, boolean?][] = [
  ['home', 'Dashboard'],
  ['chart', 'Charts'],
  ['list', 'Runs', true],
  ['folder', 'Models'],
  ['flask', 'Experiments'],
  ['sparkles', 'Auto-analysis'],
  ['review', 'Reviews'],
  ['database', 'Datasets'],
  ['settings', 'Project settings'],
];

function Shell({ crumbs, children }: { crumbs: string[]; children: ReactNode }) {
  return (
    <div className={`${shell.shell} ${styles.shellResp}`} data-testid="page-shell">
      <aside className={shell.sidebar} aria-label="Navigation">
        <div className={shell.brand}>qym</div>
        <nav className={shell.nav}>
          <span className={shell.navItem}>
            <Icon name="folder" size={14} />
            <span>Projects</span>
          </span>
          <span className={shell.navItem}>
            <Icon name="book" size={14} />
            <span>Docs</span>
          </span>
          <p className={shell.navGroup}>Multi demo</p>
          {NAV.map(([icon, label, active]) => (
            <span key={label} className={shell.navItem} data-active={active ? '' : undefined}>
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </span>
          ))}
        </nav>
        <div className={shell.user}>
          <span className={shell.avatar}>DU</span>
          <span className={shell.userText}>
            <strong>Dev User</strong>
            <span>dev@local</span>
          </span>
        </div>
      </aside>
      <div className={shell.main}>
        <div className={shell.topbar}>
          <Icon name="sidebar" size={14} />
          <span className={shell.crumbs}>
            {crumbs.map((c, i) => (
              <span key={c} className={shell.crumbs}>
                {i ? <Icon name="chevron-right" size={12} /> : null}
                {c}
              </span>
            ))}
          </span>
        </div>
        <div className={`${shell.content} ${styles.contentFix}`}>{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ data */

interface DsEntry {
  position: number;
  name: string;
  version: string;
  alias?: string;
  items: number;
  errors: number;
  deleted?: boolean;
  scores: [number, number, number];
}

const METRICS = ['answer_correctness', 'faithfulness', 'tone'] as const;
const RUN_MEAN: [number, number, number] = [0.689, 0.855, 0.781];

const E0: DsEntry = { position: 0, name: 'support-tickets', version: 'v3', items: 412, errors: 3, scores: [0.661, 0.842, 0.774] };
const E1: DsEntry = { position: 1, name: 'support-tickets', version: 'v4', items: 438, errors: 5, scores: [0.708, 0.857, 0.781] };
const E2: DsEntry = { position: 2, name: 'billing-faq', version: 'v7', alias: 'production', items: 96, errors: 0, scores: [0.719, 0.901, 0.812] };
const ENTRIES: DsEntry[] = [E0, E1, E2];
const at = (a: number[] | readonly number[], i: number): number => a[i] ?? 0;

const TOTAL_ITEMS = ENTRIES.reduce((n, e) => n + e.items, 0);

/* ------------------------------------------------------------------------------------------------ pieces */

/** One entry of the run's Datasets group: database glyph, name (wraps, never cut), version, item count. */
function DatasetChip({ e, plain }: { e: DsEntry; plain?: boolean }) {
  const body = (
    <>
      <Icon name="database" size={12} />
      <span className={styles.dsName}>{e.name}</span>
      <span className={styles.dsVersion}>{e.version}</span>
      {e.alias ? <span className={styles.dsAlias}>{e.alias}</span> : null}
      <span className={styles.dsCount}>{e.items.toLocaleString('en-US')} items</span>
      {e.deleted ? <span className={styles.dsDeleted}>deleted</span> : null}
    </>
  );
  const title = `${e.name} ${e.version}${e.alias ? ` (${e.alias})` : ''}, ${e.items} items${e.deleted ? ', dataset deleted' : ''}`;
  return e.deleted || plain ? (
    <span className={styles.dsChip} data-testid="hero-dataset-chip" data-deleted={e.deleted ? '' : undefined} title={title}>
      {body}
    </span>
  ) : (
    <a className={styles.dsChip} data-testid="hero-dataset-chip" data-link="block" href="#datasets" title={title}>
      {body}
    </a>
  );
}

function ContextBand({ entries, plain }: { entries: DsEntry[]; plain?: boolean }) {
  const flow = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  // The real band's clamp: chips that start below the two-line (five-line at 390) max height are counted.
  useLayoutEffect(() => {
    const el = flow.current;
    if (!el) return undefined;
    const measure = () => {
      const limit = el.clientHeight;
      const top = el.getBoundingClientRect().top;
      let n = 0;
      el.querySelectorAll<HTMLElement>('[data-chip]').forEach((c) => {
        if (c.getBoundingClientRect().bottom - top > limit + 1) n++;
      });
      setHidden((prev) => (prev === n ? prev : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries]);
  return (
    <div className={hero.context} role="group" aria-label="Datasets, versioning, config and metadata" data-testid="hero-context">
      <div className={hero.contextRow}>
        <div ref={flow} className={hero.flow} data-testid="hero-chips">
          <div role="list" aria-label="Datasets" className={hero.group}>
            {entries.map((e, i) => (
              <span key={e.position} className={i === 0 ? hero.lead : hero.chipWrap}>
                {i === 0 ? (
                  <span className={hero.groupLabel} aria-hidden="true">
                    Datasets
                  </span>
                ) : null}
                <span role="listitem" data-chip="" className={hero.chipItem}>
                  <DatasetChip e={e} plain={plain} />
                </span>
              </span>
            ))}
          </div>
          <div role="list" aria-label="Versioning" className={hero.group}>
            <span className={hero.lead}>
              <span className={hero.groupLabel} aria-hidden="true">
                Versioning
              </span>
              <span role="listitem" data-chip="" className={hero.chipItem}>
                <KeyValueTag label="agent_version" text="v2.4.1" />
              </span>
            </span>
          </div>
          <div role="list" aria-label="Config" className={hero.group}>
            <span className={hero.lead}>
              <span className={hero.groupLabel} aria-hidden="true">
                Config
              </span>
              <span role="listitem" data-chip="" className={hero.chipItem}>
                <KeyValueTag label="max_concurrency" text="8" />
              </span>
            </span>
          </div>
        </div>
        {hidden > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className={hero.moreBtn}
            data-testid="hero-more"
            iconEnd={<Icon name="chevron-down" size={14} />}
          >
            {`+ ${hidden} more`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={hero.fact}>
      <dt className={hero.factLabel}>{label}</dt>
      <dd className={hero.factValue}>{children}</dd>
    </div>
  );
}

function RunHeroMock({
  entries,
  name = 'release-gate-nightly',
  loading,
  single,
}: {
  entries: DsEntry[];
  name?: string;
  loading?: boolean;
  single?: boolean;
}) {
  const union = entries.length > 1;
  const first = entries[0] ?? E0;
  return (
    <Card as="section" aria-label="Run summary" tone="success" className={hero.hero} data-testid="run-hero">
      <div className={hero.heroBody}>
        <div className={hero.top}>
          <div className={hero.headline}>
            <h1 className={hero.name}>{name}</h1>
            <IconButton label="Copy run id" icon="copy" onPress={noop} />
          </div>
          <div className={hero.right}>
            <RunStatusBadge status="COMPLETED" label="COMPLETED" />
            <LinkButton variant="accent" size="sm" href="#export" icon={<Icon name="external" size={14} />}>
              Export HTML
            </LinkButton>
          </div>
        </div>
        <dl className={hero.facts} aria-label="Run facts" data-testid="run-hero-strip">
          <Fact label="Task">
            <TaskTag name="answer-ticket" />
          </Fact>
          <Fact label={union ? 'Datasets' : 'Dataset'}>
            {union ? (
              <a className={styles.countLink} data-link="block" href="#datasets" data-testid="hero-datasets-fact">
                <Tag kind="count" title={entries.map((e) => `${e.name} ${e.version}`).join(', ')}>
                  <Icon name="database" size={12} /> {entries.length} datasets
                </Tag>
              </a>
            ) : (
              <DatasetTag name={first.name} version={first.version} aliases={first.alias ? [first.alias] : []} />
            )}
          </Fact>
          <Fact label="Model">
            <ModelTag name="gpt-4o" series={1} />
          </Fact>
          <Fact label="Owner">Dev User</Fact>
          <Fact label="Project">Multi demo</Fact>
          <Fact label="Started">Oct 22, 2026, 3:50 PM</Fact>
          <Fact label="Runtime">{loading ? '…' : '1h 12m'}</Fact>
        </dl>
        {union && !single ? <ContextBand entries={entries} /> : null}
      </div>
    </Card>
  );
}

function SectionNavMock({ union }: { union: boolean }) {
  const links: [string, number | null][] = [
    ['Overview', null],
    ...(union ? ([['Datasets', 3]] as [string, number][]) : []),
    ['Latency', null],
    ['Deep', null],
    ['Categories', null],
    ['Errors', 8],
    ['Items', TOTAL_ITEMS],
  ];
  return (
    <div className={`${nav.nav} ${styles.navStatic}`} data-testid="section-nav">
      <div className={nav.links}>
        <span className={nav.link} aria-current="location">
          Summary
        </span>
        {links.map(([l, c]) => (
          <span key={l} className={nav.link} data-testid={`nav-${l.toLowerCase()}`}>
            {l}
            {c != null ? <span className={nav.count}>{c.toLocaleString('en-US')}</span> : null}
          </span>
        ))}
      </div>
      <Button variant="neutral" size="sm" icon={<Icon name="list" size={12} />}>
        Filters
      </Button>
    </div>
  );
}

function OverviewMock({ total }: { total: number }) {
  return (
    <ReportSection
      id="overview"
      title="Overview"
      description="Score distributions per metric. Click a bar to filter the items."
      aside={
        <StatStrip
          variant="compact-header"
          aria-label="Run counts"
          items={[
            { key: 'items', label: 'Items', value: total.toLocaleString('en-US') },
            { key: 'completed', label: 'Completed', value: (total - 8).toLocaleString('en-US') },
            { key: 'errors', label: 'Errors', value: '8' },
          ]}
        />
      }
    >
      <div className={styles.metricCards}>
        {METRICS.map((m, i) => (
          <Card key={m} className={styles.metricCard}>
            <div className={styles.metricHead}>
              <Text variant="md" weight={600} as="span">
                {m}
              </Text>
              <Tag kind="data">{total - 8} scored</Tag>
            </div>
            <ScoreValue value={at(RUN_MEAN, i)} digits={1} direction="higher" variant="text" />
            <div className={styles.bars} aria-hidden="true">
              {[3, 7, 12, 22, 31, 18, 9, 5].map((h, k) => (
                <span key={k} className={styles.bar} style={{ blockSize: `${h * 2.6}px` }} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </ReportSection>
  );
}

/** The new section: one table, one row per dataset entry, a summary row with the run's own numbers. */
function deltaText(v: number, mean: number): string {
  const d = (v - mean) * 100;
  if (Math.abs(d) < 0.05) return '0.0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

function BreakdownTable({ entries, loading }: { entries: DsEntry[]; loading?: boolean }) {
  const columns: Column<DsEntry>[] = [
    {
      id: 'dataset',
      header: 'Dataset',
      width: 150,
      flex: true,
      minWidth: 150,
      priority: 1,
      cardTitle: true,
      cell: (e) => (
        <span className={styles.dsCell} data-deleted={e.deleted ? '' : undefined}>
          <DatasetTag name={e.name} version={e.version} aliases={e.alias ? [e.alias] : []} />
          {e.deleted ? <span className={styles.dsDeleted}>deleted</span> : null}
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
      cell: (e) => (loading ? <Skeleton kind="value" width={36} height={12} /> : <span className={styles.num}>{e.items.toLocaleString('en-US')}</span>),
      summary: <span className={styles.num}>{TOTAL_ITEMS.toLocaleString('en-US')}</span>,
    },
    {
      id: 'errors',
      header: 'Errors',
      width: 60,
      priority: 2,
      type: 'number',
      cell: (e) => (loading ? <Skeleton kind="value" width={20} height={12} /> : <span className={styles.num}>{e.errors}</span>),
      summary: <span className={styles.num}>8</span>,
    },
    ...METRICS.map<Column<DsEntry>>((m, i) => ({
      id: m,
      header: m,
      group: 'Mean score',
      width: 104,
      priority: 2,
      type: 'number',
      cell: (e) =>
        loading ? (
          <Skeleton kind="value" width={48} height={12} />
        ) : (
          <span className={styles.scoreCell}>
            <ScoreValue value={at(e.scores, i)} digits={1} direction="higher" />
            <span className={styles.delta} data-sign={at(e.scores, i) >= at(RUN_MEAN, i) ? 'up' : 'down'}>
              {deltaText(at(e.scores, i), at(RUN_MEAN, i))}
            </span>
          </span>
        ),
      summary: <ScoreValue value={at(RUN_MEAN, i)} digits={1} direction="higher" />,
    })),
    {
      id: 'show',
      header: '',
      label: 'Show items',
      width: 88,
      priority: 1,
      cell: (e) => (
        <a className={styles.showLink} data-link="block" href="#items" data-testid="show-items-link">
          Show {e.items.toLocaleString('en-US')} <Icon name="chevron-right" size={12} />
        </a>
      ),
    },
  ];
  return (
    <ReportSection
      id="datasets"
      title="Datasets"
      description="Scores per source dataset. The run's own mean is the summary row; the grey figure is each dataset's distance from it."
      aside={<Tag kind="count">{entries.length} datasets</Tag>}
    >
      <DataTable<DsEntry>
        aria-label="Scores per dataset"
        density="regular"
        rows={entries}
        rowKey={(e) => `${e.position}`}
        columns={columns}
        data-testid="dataset-breakdown"
      />
    </ReportSection>
  );
}

interface ItemRow {
  index: number;
  id: string;
  ds: DsEntry;
  input: string;
  scores: [number, number, number];
}
const ITEM_ROWS: ItemRow[] = [
  [0, 't-0007', 0, 'Where is my refund for order 88412?', [0.9, 0.95, 0.8]],
  [1, 't-0008', 0, 'The app crashes when I upload an invoice.', [0.4, 0.8, 0.7]],
  [2, 't-0001', 1, 'Where is my refund for order 90117?', [1, 0.9, 0.8]],
  [3, 't-0002', 1, 'Can I change the billing email on my plan?', [0.7, 0.85, 0.8]],
  [4, 'q-0102', 2, 'How do I download last month’s invoice?', [0.8, 0.95, 0.9]],
  [5, 'q-0103', 2, 'Why was I charged twice in September?', [0.6, 0.9, 0.8]],
].map(([index, id, d, input, scores]) => ({
  index: index as number,
  id: id as string,
  ds: ENTRIES[d as number] ?? E0,
  input: input as string,
  scores: scores as [number, number, number],
}));

function ItemsMock({ filtered }: { filtered?: boolean }) {
  const columns: Column<ItemRow>[] = [
    { id: 'index', header: '#', width: 56, priority: 1, cell: (r) => <span className={styles.num}>{r.index}</span> },
    {
      id: 'dataset',
      header: 'Dataset',
      width: 224,
      priority: 1,
      cell: (r) => <DatasetTag name={r.ds.name} version={r.ds.version} />,
    },
    {
      id: 'id',
      header: 'Item',
      width: 96,
      priority: 2,
      cardTitle: true,
      cell: (r) => <span className={styles.num}>{r.id}</span>,
    },
    { id: 'input', header: 'Input', flex: true, minWidth: 220, priority: 1, cell: (r) => r.input },
    ...METRICS.map<Column<ItemRow>>((m, i) => ({
      id: m,
      header: m,
      width: 150,
      priority: 2,
      type: 'number',
      cell: (r) => <ScoreValue value={at(r.scores, i)} digits={0} direction="higher" />,
    })),
  ];
  return (
    <ReportSection id="items" title="Items" description={`${TOTAL_ITEMS.toLocaleString('en-US')} items across 3 datasets.`}>
      <div className={styles.itemsBar}>
        <span className={styles.datasetFilter} data-testid="dataset-filter">
          <span className={styles.filterLabel}>Dataset</span>
          <span className={styles.filterValue}>{filtered ? 'support-tickets v4' : 'All datasets'}</span>
          <Icon name="chevron-down" size={12} />
        </span>
        {filtered ? (
          <Chip isSelected onRemove={noop} removeLabel="Remove filter Dataset: support-tickets v4">
            Dataset: support-tickets v4
          </Chip>
        ) : null}
        <span className={styles.count}>{filtered ? '438 items' : `${TOTAL_ITEMS} items`}</span>
      </div>
      <DataTable<ItemRow>
        aria-label="Run items"
        density="regular"
        rows={filtered ? ITEM_ROWS.slice(2, 4) : ITEM_ROWS}
        rowKey={(r) => `${r.ds.position}/${r.id}`}
        columns={columns}
      />
    </ReportSection>
  );
}

/* ------------------------------------------------------------------------------------------------ runs list */

interface ListRow {
  id: string;
  name: string;
  datasets: DsEntry[];
  model: string;
  series: 1 | 2;
  date: string;
  score: number;
}
const LIST: ListRow[] = [
  { id: '1', name: 'release-gate-nightly', datasets: ENTRIES, model: 'gpt-4o', series: 1, date: 'Oct 22 · 15:50', score: 0.689 },
  { id: '2', name: 'ticket-triage-nightly', datasets: [E0], model: 'gpt-4o', series: 1, date: 'Oct 22 · 11:05', score: 0.661 },
  {
    id: '3',
    name: 'release-gate-2026-10-21',
    datasets: [E0, { ...E2, position: 1 }],
    model: 'gpt-4o-mini',
    series: 2,
    date: 'Oct 21 · 15:48',
    score: 0.655,
  },
  { id: '4', name: 'billing-faq-check', datasets: [E2], model: 'gpt-4o', series: 1, date: 'Oct 21 · 09:12', score: 0.719 },
];

export function DatasetCell({ datasets }: { datasets: DsEntry[] }) {
  if (datasets.length === 1) {
    const e = datasets[0] ?? E0;
    return <DatasetTag name={e.name} version={e.version} aliases={e.alias ? [e.alias] : []} />;
  }
  return (
    <Tag
      kind="count"
      title={datasets.map((e) => `${e.name} ${e.version}`).join(' · ')}
      data-testid="dataset-count-tag"
    >
      <Icon name="database" size={12} /> {datasets.length} datasets
    </Tag>
  );
}

function RunsListMock() {
  const columns: Column<ListRow>[] = [
    {
      id: 'run',
      header: 'Run',
      width: 150,
      flex: true,
      minWidth: 150,
      priority: 1,
      cardTitle: true,
      cell: (r) => <span className={styles.runName}>{r.name}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      width: 112,
      priority: 1,
      cell: () => <RunStatusBadge status="COMPLETED" label="COMPLETED" />,
    },
    {
      id: 'model',
      header: 'Model',
      group: 'Context',
      width: 112,
      priority: 2,
      cell: (r) => <ModelTag name={r.model} series={r.series} />,
    },
    {
      id: 'dataset',
      header: 'Dataset',
      group: 'Context',
      width: 120,
      priority: 1,
      cell: (r) => <DatasetCell datasets={r.datasets} />,
    },
    { id: 'date', header: 'Date', group: 'Context', width: 104, priority: 2, cell: (r) => <span className={styles.num}>{r.date}</span> },
    {
      id: 'score',
      header: 'answer_correctness',
      group: 'Scores',
      width: 120,
      priority: 1,
      type: 'number',
      cell: (r) => <ScoreValue value={r.score} digits={1} direction="higher" />,
    },
  ];
  return (
    <div className={styles.listPage}>
      <div className={styles.listToolbar}>
        <span className={styles.search}>
          <Icon name="search" size={12} /> Search runs
        </span>
        <span className={styles.datasetFilter} data-testid="runs-dataset-filter">
          <span className={styles.filterLabel}>Dataset</span>
          <span className={styles.filterValue}>Any</span>
          <Icon name="chevron-down" size={12} />
        </span>
      </div>
      <DataTable<ListRow>
        aria-label="Runs"
        density="regular"
        rows={LIST}
        rowKey={(r) => r.id}
        columns={columns}
        data-testid="runs-table"
      />
      <Text variant="sm" tone="muted">
        Columns reduced to the ones this round touches; the real table has Overview, Context, Scores and System groups.
      </Text>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ compare */

function CompareCard({ letter, name, datasets, model, items }: { letter: string; name: string; datasets: DsEntry[]; model: string; items: number }) {
  return (
    <li className={styles.cmpCard}>
      <Card data-testid="compare-run-card">
        <div className={styles.cmpHead}>
          <span className={styles.cmpLetter}>{letter}</span>
          <span className={styles.runName}>{name}</span>
          <RunStatusBadge status="COMPLETED" label="COMPLETED" />
        </div>
        <dl className={styles.cmpFacts}>
          <Fact label="Task">
            <TaskTag name="answer-ticket" />
          </Fact>
          <Fact label={datasets.length > 1 ? 'Datasets' : 'Dataset'}>
            <DatasetCell datasets={datasets} />
          </Fact>
          <Fact label="Model">
            <ModelTag name={model} series={1} />
          </Fact>
          <Fact label="Items">
            <span className={styles.num}>{items.toLocaleString('en-US')}</span>
          </Fact>
        </dl>
      </Card>
    </li>
  );
}

function CompareMock() {
  return (
    <div className={styles.cmpPage}>
      <div>
        <Text variant="xl" weight={650} as="h1" className={styles.cmpTitle}>
          Compare runs
        </Text>
        <Text variant="base" tone="secondary">
          2 runs · release-gate-nightly is the baseline
        </Text>
      </div>
      <ul className={styles.cmpCards} aria-label="Runs in this comparison" data-testid="run-details">
        <CompareCard letter="A" name="release-gate-nightly" datasets={ENTRIES} model="gpt-4o" items={TOTAL_ITEMS} />
        <CompareCard letter="B" name="ticket-triage-nightly" datasets={[E0]} model="gpt-4o" items={412} />
      </ul>
      <div className={styles.notice} role="status" data-testid="compare-datasets-notice">
        <Icon name="info" size={16} />
        <div>
          <div className={styles.noticeTitle}>The runs evaluated different datasets</div>
          <p className={styles.noticeBody}>
            Run A evaluated 3 datasets and run B evaluated 1. Items are matched by dataset and item id, so the two runs share{' '}
            <b>0</b> items; the metric averages below are still comparable as run means.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ the anchor */

const MANY: DsEntry[] = Array.from({ length: 12 }, (_, i) => ({
  position: i,
  name: ['support-tickets', 'billing-faq', 'refund-cases', 'onboarding-checks'][i % 4] ?? 'dataset',
  version: `v${Math.floor(i / 4) + 2}`,
  items: 80 + i * 17,
  errors: i % 5 === 0 ? 1 : 0,
  scores: [0.6 + (i % 5) / 20, 0.8 + (i % 3) / 30, 0.75 + (i % 4) / 40] as [number, number, number],
}));

const DELETED: DsEntry[] = [E0, E1, { ...E2, deleted: true }];

export function MultiSdkMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="multi-sdk" title="Multi-dataset round: the run of several datasets (WP-C design contract)">
      <Case wide label="multi-page-run (QC-U1 to QC-U30: run detail of a union run, 3 datasets, default state)">
        <Shell crumbs={['Multi demo', 'Runs', 'release-gate-nightly']}>
          <RunHeroMock entries={ENTRIES} />
          <SectionNavMock union />
          <OverviewMock total={TOTAL_ITEMS} />
          <BreakdownTable entries={ENTRIES} />
          <ItemsMock />
        </Shell>
      </Case>
      <Case wide label="multi-page-run-filtered (QC-U22 to QC-U26: the same page after Show 438 on support-tickets v4)">
        <Shell crumbs={['Multi demo', 'Runs', 'release-gate-nightly']}>
          <RunHeroMock entries={ENTRIES} />
          <SectionNavMock union />
          <ItemsMock filtered />
        </Shell>
      </Case>
      <Case wide label="multi-page-runs (QC-U31 to QC-U36: the runs list with two union runs among single-dataset runs)">
        <Shell crumbs={['Multi demo', 'Runs']}>
          <RunsListMock />
        </Shell>
      </Case>
      <Case wide label="multi-page-compare (QC-U37 to QC-U40: compare cards of a union run against a single-dataset run)">
        <Shell crumbs={['Multi demo', 'Compare']}>
          <CompareMock />
        </Shell>
      </Case>
      <Case wide label="multi-state-single (QC-U41: a single-dataset run is exactly today's page, no Datasets band, section, nav entry or column)">
        <Shell crumbs={['Multi demo', 'Runs', 'ticket-triage-nightly']}>
          <RunHeroMock entries={[E0]} name="ticket-triage-nightly" />
          <SectionNavMock union={false} />
        </Shell>
      </Case>
      <Case wide label="multi-state-loading (QC-U42: the Datasets section while the breakdown loads, same height as loaded)">
        <Shell crumbs={['Multi demo', 'Runs', 'release-gate-nightly']}>
          <RunHeroMock entries={ENTRIES} loading />
          <BreakdownTable entries={ENTRIES} loading />
        </Shell>
      </Case>
      <Case wide label="multi-state-deleted (QC-U43: billing-faq was deleted after the run; numbers stay, the link goes)">
        <Shell crumbs={['Multi demo', 'Runs', 'release-gate-nightly']}>
          <RunHeroMock entries={DELETED} />
          <BreakdownTable entries={DELETED} />
        </Shell>
      </Case>
      <Case wide label="multi-state-many (QC-U44: 12 datasets, the Datasets group clamps with an exact + N more)">
        <Shell crumbs={['Multi demo', 'Runs', 'nightly-all-sets']}>
          <RunHeroMock entries={MANY} name="nightly-all-sets" />
          <BreakdownTable entries={MANY} />
        </Shell>
      </Case>
    </Sec>
  );
}
