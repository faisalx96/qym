/**
 * Round 3 run-detail mocks (design stage): static, hand-fed visual contracts for
 * docs/internal/ui-migration/redesign3/run-detail.md. Primitives and tokens only; nothing here reads the API.
 * Cases: r3-run-header, r3-chart-cards, r3-repeat-panel, r3-categories, r3-item-details (+ Arabic, 10 passes).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Button,
  Card,
  Chip,
  CopyButton,
  DatasetTag,
  Icon,
  IconButton,
  LinkButton,
  ModelTag,
  RunStatusBadge,
  ScoreValue,
  SegmentedControl,
  Select,
  Tag,
  TaskTag,
  Text,
} from '@/ui';
import { useMeasuredWidth } from '@/features/run-detail/components/charts/Charts';
import styles from './Round3Mocks.module.css';

const style = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ───────────────────────────── P6: run header ───────────────────────────── */

const FACTS: Array<[string, ReactNode]> = [
  ['Task', <TaskTag key="t" name="rag_answer" />],
  ['Dataset', <DatasetTag key="d" name="qa-arabic-v3" version="4" />],
  ['Model', <ModelTag key="m" name="gpt-5-mini" />],
  ['Owner', 'Dev User'],
  ['Project', 'R3 seed'],
  ['Started', 'Oct 1, 2026, 3:00 PM'],
  [
    'Runtime',
    <span key="r" className={styles.mono}>
      6m 3s
    </span>,
  ],
];

const VERSIONING: Array<[string, string]> = [
  ['model_tag', '2026-09'],
  ['prompt', 'v7'],
  ['retriever_index', 'qa-v3'],
];
const VERSION: Array<[string, string]> = [['git', 'main • a1b2c3d']];
const CONFIG: Array<[string, string]> = [
  ['temperature', '0.2'],
  ['max_tokens', '512'],
];
const META: Array<[string, string]> = [
  ['run_name', 'classic-rag-eval'],
  ['judge', 'gpt-5'],
  ['seed', '1234'],
  ['sampler', '{ 3 keys }'],
  ['region', 'eu-west-1'],
  ['batch_size', '16'],
  ['retries', '2'],
  ['timeout_s', '120'],
  ['tokenizer', 'o200k_base'],
  ['dataset_hash', '9f3a1c7e22b0'],
  ['owner_team', 'evals-platform'],
  ['notes', 'nightly regression, Arabic subset'],
];

function KvChip({ k, v }: { k: string; v: string }) {
  return (
    <span className={styles.kv} title={`${k}: ${v}`}>
      <span className={styles.kvKey}>{k}</span>
      <span className={styles.kvVal}>{v}</span>
    </span>
  );
}

export function RunHeaderMock({ width }: { width?: number }) {
  const [more, setMore] = useState(false);
  const groups: Array<{ label: string; kvs: Array<[string, string]> }> = [
    { label: 'Versioning', kvs: [...VERSIONING, ...VERSION] },
    { label: 'Config', kvs: CONFIG },
    { label: 'Metadata', kvs: META },
  ];
  return (
    <div className={styles.headerHost} style={width ? { maxInlineSize: width } : undefined}>
      <Card as="section" aria-label="Run summary" tone="success" className={styles.hero} data-r3="run-header">
        <div className={styles.heroTop}>
          <h1 className={styles.heroName}>
            <span className={styles.mono}>426fd13d-390a-4f31-9edc-ac2b0c79c9d1</span>
          </h1>
          <Tag kind="count" title="10 passes per item">
            x10 passes
          </Tag>
          <span className={styles.heroActions}>
            <RunStatusBadge status="COMPLETED" label="COMPLETED" />
            <LinkButton variant="accent" size="sm" href="#export" icon={<Icon name="external" size={14} />}>
              Export HTML
            </LinkButton>
            <span className={styles.pager}>
              <Icon name="chevron-left" size={14} />
              <span className={styles.mono}>5 of 5</span>
              <Icon name="chevron-right" size={14} />
            </span>
          </span>
        </div>
        <dl className={styles.facts} aria-label="Run facts">
          {FACTS.map(([label, value]) => (
            <div key={label} className={styles.fact}>
              <dt className={styles.factLabel}>{label}</dt>
              <dd className={styles.factValue}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.context} aria-label="Versioning, config and metadata">
          <div className={styles.flow} data-open={more ? '' : undefined}>
            {groups.map((g) => (
              <span key={g.label} className={styles.group}>
                <span className={styles.lead}>
                  <span className={styles.groupLabel}>{g.label}</span>
                  <KvChip k={g.kvs[0]![0]} v={g.kvs[0]![1]} />
                </span>
                {g.kvs.slice(1).map(([k, v]) => (
                  <KvChip key={k} k={k} v={v} />
                ))}
              </span>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={styles.moreBtn}
            aria-expanded={more}
            onPress={() => setMore((v) => !v)}
            iconEnd={<Icon name={more ? 'chevron-up' : 'chevron-down'} size={14} />}
          >
            {more ? 'Show less' : '+ 6 more'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────────── P1: chart cards ───────────────────────────── */

interface Bar {
  label: string;
  count: number;
  pct?: string;
  tone: 1 | 2 | 3 | 4 | 5;
  err?: number;
}

function BarPlot({ bars, name }: { bars: Bar[]; name: string }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className={styles.plot} role="group" aria-label={name}>
      {bars.map((b, bi) => (
        <button
          key={b.label}
          type="button"
          className={styles.col}
          style={style({ '--p': b.count / max })}
          aria-label={`${b.label}: ${b.count} items, filter the table`}
        >
          <span className={styles.count} data-zero={b.count === 0 ? '' : undefined}>
            {b.count || ''}
          </span>
          <span className={styles.bar} data-band={b.tone} />
          <span className={styles.axis}>{bars.length > 8 && bi % 2 === 1 ? '' : b.label}</span>
          {b.pct ? <span className={styles.axisSub}>{b.pct}</span> : null}
        </button>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  meta,
  value,
  band,
  note,
  children,
}: {
  title: string;
  meta: string;
  value?: ReactNode;
  band?: 1 | 2 | 3 | 4 | 5;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Card
      as="section"
      aria-label={title}
      className={styles.chartCard}
      band={band}
      header={
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>{title}</span>
          <Tag kind="count">{meta}</Tag>
        </div>
      }
    >
      {value ? <div className={styles.cardValue}>{value}</div> : null}
      {note ? <div className={styles.cardNote}>{note}</div> : null}
      <div className={styles.slot}>{children}</div>
    </Card>
  );
}

export function ChartCardsMock() {
  const score: Bar[] = (
    [
      [31, 1, 0],
      [10, 1, 10],
      [10, 2, 20],
      [31, 2, 30],
      [38, 3, 40],
      [24, 3, 50],
      [33, 4, 60],
      [29, 4, 70],
      [7, 5, 80],
      [14, 5, 90],
      [10, 5, 100],
    ] as Array<[number, number, number]>
  ).map(([count, tone, pct]) => ({ count, tone: tone as Bar['tone'], label: `${pct}%` }));
  const hall: Bar[] = [15, 17, 23, 35, 29, 32, 27, 20, 16, 7, 4].map((count, i) => ({
    count,
    tone: (i < 3 ? 5 : i < 5 ? 4 : i < 7 ? 3 : i < 9 ? 2 : 1) as Bar['tone'],
    label: `${i * 10}%`,
  }));
  return (
    <div className={styles.chartGrid} data-r3="chart-cards">
      <ChartCard
        title="exact_match"
        meta="237 items"
        band={1}
        value={<ScoreValue value={0.198} type="percentage" direction="maximize" />}
        note="12 task errors, counted as 0%"
      >
        <BarPlot
          name="exact_match pass and fail split"
          bars={[
            { label: 'Pass', count: 47, tone: 5, pct: '20%' },
            { label: 'Fail', count: 178, tone: 1, pct: '75%' },
            { label: 'Error', count: 12, tone: 3, pct: '5%' },
          ]}
        />
      </ChartCard>
      <ChartCard
        title="quality"
        meta="217 scored · 20 err"
        band={2}
        value={<ScoreValue value={0.494} type="percentage" direction="maximize" />}
        note="8 scorer errors and 12 task errors, counted as 0%"
      >
        <BarPlot name="quality score distribution" bars={score} />
      </ChartCard>
      <ChartCard
        title="hallucination"
        meta="225 scored · 12 err"
        band={2}
        value={<ScoreValue value={0.477} type="percentage" direction="minimize" />}
        note="12 errors, not counted in the mean"
      >
        <BarPlot name="hallucination score distribution" bars={hall} />
      </ChartCard>
      <ChartCard
        title="tokens_used"
        meta="237 items"
        value={<span className={styles.mono}>506.8</span>}
        note="12 task errors, counted as 0"
      >
        <div className={styles.statRow}>
          {[
            ['Min', '0'],
            ['Avg', '506.8'],
            ['Max', '976'],
            ['Total', '120.1K'],
          ].map(([k, v]) => (
            <div key={k} className={styles.statCell}>
              <span className={styles.statLabel}>{k}</span>
              <span className={styles.statValue}>{v}</span>
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

/* ───────────────────────────── P2: repeat panel ───────────────────────────── */

const METRICS = [
  'correct',
  ...Array.from({ length: 23 }, (_, i) => `rubric_metric_${String(i + 1).padStart(2, '0')}`),
];

const TILES: Array<{ label: string; value: string; line: string; band?: 1 | 2 | 3 | 4 | 5 }> = [
  { label: 'Pass@10', value: '100.0%', line: 'Items that passed in at least 1 of 10 passes', band: 5 },
  { label: 'Pass^10', value: '4.2%', line: 'Items that passed in all 10 passes', band: 1 },
  { label: 'Consistency', value: '33.3%', line: 'Items whose 10 passes all agree', band: 2 },
  { label: 'Reliability', value: '56.7%', line: 'Chance a pass is correct, averaged over items', band: 3 },
  { label: 'Avg score', value: '56.7%', line: 'Mean of the metric over all passes', band: 3 },
  { label: 'Avg latency', value: '1.8s', line: 'Mean time per item and pass' },
  { label: 'Errors', value: '0', line: 'Item runs that failed to produce an output' },
];

const PASS_ROWS = [
  [50.0, 1.9, 2.0, 0, 24],
  [54.2, 1.8, 1.7, 0, 24],
  [66.7, 1.8, 1.8, 0, 24],
  [50.0, 1.9, 1.9, 0, 24],
  [75.0, 1.7, 1.7, 0, 24],
  [66.7, 1.8, 1.7, 0, 24],
  [41.7, 1.9, 1.8, 0, 24],
  [54.2, 1.8, 1.8, 0, 24],
  [41.7, 1.9, 1.9, 0, 24],
  [66.7, 1.8, 1.7, 0, 24],
];

function CurveSvg() {
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>(760);
  const narrow = W < 500;
  const H = narrow ? 220 : 240;
  const pad = { l: 40, r: narrow ? 16 : 24, t: 20, b: narrow ? 44 : 28 };
  const atk = [0.567, 0.796, 0.902, 0.953, 0.978, 0.991, 0.997, 0.999, 1, 1];
  const pwk = [0.567, 0.337, 0.213, 0.143, 0.102, 0.077, 0.061, 0.052, 0.046, 0.042];
  const sx = (i: number) => pad.l + (i / 9) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - v * (H - pad.t - pad.b);
  const path = (a: number[]) => `M${a.map((v, i) => `${sx(i)},${sy(v)}`).join('L')}`;
  return (
    <div ref={boxRef}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className={styles.curve}
        role="img"
        aria-label="Pass@k and Pass^k by attempts allowed"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className={styles.grid} x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
            <text className={styles.tick} x={pad.l - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        <path d={path(atk)} className={styles.line} data-series="1" />
        <path d={path(pwk)} className={styles.line} data-series="5" strokeDasharray="5 4" />
        {atk.map((v, i) => (
          <g key={i}>
            <circle cx={sx(i)} cy={sy(v)} r={4} className={styles.dot} data-series="1" />
            <circle cx={sx(i)} cy={sy(pwk[i]!)} r={4} className={styles.dot} data-series="5" />
            {(narrow ? i === 0 || i === 9 : i === 0 || i === 2 || i === 4 || i === 9) ? (
              <>
                <text
                  className={styles.pointLabel}
                  x={sx(i)}
                  y={sy(v) - 9}
                  textAnchor={i === 9 ? 'end' : 'middle'}
                >
                  {(v * 100).toFixed(1)}%
                </text>
                {i > 0 ? (
                  <text
                    className={styles.pointLabel}
                    x={sx(i)}
                    y={sy(pwk[i]!) + 17}
                    textAnchor={i === 9 ? 'end' : 'middle'}
                  >
                    {(pwk[i]! * 100).toFixed(1)}%
                  </text>
                ) : null}
              </>
            ) : null}
            {!narrow || i % 3 === 0 || i === 9 ? (
              <text className={styles.tick} x={sx(i)} y={H - 8} textAnchor="middle">
                k={i + 1}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function RepeatPanelMock() {
  const [metric, setMetric] = useState<string>('correct');
  const dist = [0, 0, 1, 2, 5, 4, 3, 5, 2, 1, 1];
  const max = Math.max(...dist);
  return (
    <div className={styles.repeat} data-r3="repeat-panel">
      <div className={styles.repeatControl}>
        <Select
          label="Metric"
          items={METRICS.map((m) => ({ key: m, label: m }))}
          value={metric}
          onChange={(k) => k && setMetric(String(k))}
          width={280}
        />
        <Text variant="sm" tone="muted" className={styles.controlHelp}>
          One metric drives the tiles, the curve and the distribution. The table below shows every pass.
        </Text>
      </div>
      <Text variant="base" tone="primary" className={styles.verdict}>
        Pass@10 100.0%, Pass^10 4.2%: 96 pts of items pass at least once but not every time.
      </Text>
      <div className={styles.tiles} role="list" aria-label="Repeat run statistics">
        {TILES.map((t) => (
          <Card key={t.label} className={styles.tile} compact band={t.band} rail="bottom" role="listitem">
            <span className={styles.tileLabel}>{t.label}</span>
            <span className={styles.tileValue} data-band={t.band}>
              {t.value}
            </span>
            <span className={styles.tileLine}>{t.line}</span>
          </Card>
        ))}
      </div>
      <div className={styles.twoUp}>
        <Card
          as="section"
          aria-label="Across attempts"
          header={
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>Across attempts</span>
              <span className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={styles.swatch} data-series="1" aria-hidden="true" />
                  Pass@k
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.swatch} data-series="5" aria-hidden="true" />
                  Pass^k
                </span>
                <SegmentedControl
                  label="Curve"
                  value="chart"
                  onChange={() => {}}
                  options={[
                    { value: 'chart', label: 'Chart' },
                    { value: 'table', label: 'Table' },
                  ]}
                />
              </span>
            </div>
          }
        >
          <CurveSvg />
        </Card>
        <Card
          as="section"
          aria-label="Passes passed"
          header={
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>Passes passed</span>
              <Text variant="sm" tone="muted">
                Items by passes that passed
              </Text>
            </div>
          }
        >
          <div
            className={styles.plot}
            role="group"
            aria-label="Items by number of passes that passed"
            data-compact=""
          >
            {dist.map((c, i) => (
              <button
                key={i}
                type="button"
                className={styles.col}
                style={style({ '--p': c / max })}
                aria-label={`${c} items passed ${i} of 10`}
              >
                <span className={styles.count}>{c}</span>
                <span className={styles.bar} data-band={i === 0 ? 1 : i === 10 ? 5 : 3} />
                <span className={styles.axis}>{i}</span>
              </button>
            ))}
          </div>
          <div className={styles.axisCaption}>
            Passes passed, out of 10 (0 = always fail, 10 = always pass)
          </div>
        </Card>
      </div>
      <Card
        as="section"
        aria-label="By pass"
        flush
        header={
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>By pass</span>
            <Text variant="sm" tone="muted">
              Metrics shown: {metric} (1 of 24)
            </Text>
          </div>
        }
      >
        <div className={styles.tableWrap}>
          <div role="table" aria-label="Table" className={styles.table}>
            <div role="rowgroup">
              <div role="row" className={styles.trow} data-head="">
                <div role="columnheader">Pass</div>
                <div role="columnheader" data-emph="">
                  {metric}
                </div>
                <div role="columnheader" data-wide="">
                  Avg latency
                </div>
                <div role="columnheader" data-wide="">
                  Median
                </div>
                <div role="columnheader">Errors</div>
                <div role="columnheader" data-wide="">
                  Items
                </div>
              </div>
            </div>
            <div role="rowgroup">
              {PASS_ROWS.map((r, i) => (
                <div role="row" key={i} className={styles.trow}>
                  <div role="cell">
                    <Tag kind="count">Pass {i + 1}</Tag>
                  </div>
                  <div role="cell" data-emph="">
                    <ScoreValue value={r[0]! / 100} type="percentage" direction="maximize" digits={1} />
                    {r[0] === 75 ? (
                      <Tag tone="success" className={styles.rank}>
                        best
                      </Tag>
                    ) : r[0] === 41.7 && i === 6 ? (
                      <Tag tone="danger" className={styles.rank}>
                        worst
                      </Tag>
                    ) : null}
                  </div>
                  <div role="cell" className={styles.mono} data-wide="">
                    {r[1]!.toFixed(1)}s
                  </div>
                  <div role="cell" className={styles.mono} data-wide="">
                    {r[2]!.toFixed(1)}s
                  </div>
                  <div role="cell" className={styles.mono}>
                    {r[3]}
                  </div>
                  <div role="cell" className={styles.mono} data-wide="">
                    {r[4]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────────── P3: categories ───────────────────────────── */

const CAT_ROWS = [
  ['expert', 0.25, 66, 0, '3.1s'],
  ['hard', 0.48, 69, 0.19, '1.4s'],
  ['medium', 0.49, 51, 0.1, '1.4s'],
  ['easy', 0.8, 54, 0.77, '1.5s'],
] as const;

const bandOf = (v: number) => (v < 0.4 ? 1 : v < 0.6 ? 2 : v < 0.75 ? 3 : v < 0.9 ? 4 : 5);

export function CategoriesMock() {
  const [key, setKey] = useState<string>('complexity');
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className={styles.cats} data-r3="categories">
      <div className={styles.catsControl}>
        <SegmentedControl
          label="Category"
          value={key as 'complexity'}
          onChange={setKey}
          options={[
            { value: 'complexity', label: 'complexity · 4' },
            { value: 'domain', label: 'domain · 5' },
            { value: 'source', label: 'source · 2' },
            { value: 'region', label: 'region · 9' },
          ]}
        />
        <Text variant="sm" tone="muted">
          Metric: quality · overall 49%
        </Text>
      </div>
      <Card
        as="section"
        aria-label={`Performance by ${key}`}
        header={
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              {key} <span className={styles.cardSub}>4 values</span>
            </span>
            <span className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.tickKey} aria-hidden="true" />
                Overall average
              </span>
              <SegmentedControl
                label="Order"
                value="worst"
                onChange={() => {}}
                options={[
                  { value: 'worst', label: 'Worst first' },
                  { value: 'best', label: 'Best first' },
                ]}
              />
            </span>
          </div>
        }
      >
        <p className={styles.insight}>Weakest: expert 25% (24 pts below overall). Strongest: easy 80%.</p>
        <div className={styles.catHead} aria-hidden="true">
          <span>Value</span>
          <span>Average</span>
          <span className={styles.num}>Items</span>
          <span className={styles.num}>Pass</span>
          <span className={styles.num}>Latency</span>
        </div>
        <div role="group" aria-label="Values, worst first" className={styles.catList}>
          {CAT_ROWS.map(([name, avg, items, pass, lat]) => (
            <button
              key={name}
              type="button"
              className={styles.catRow}
              aria-pressed={sel === name}
              data-selected={sel === name ? '' : undefined}
              onClick={() => setSel(sel === name ? null : name)}
            >
              <span className={styles.catName}>{name}</span>
              <span className={styles.catBarCell}>
                <span className={styles.catTrack} data-band={bandOf(avg)}>
                  <span className={styles.catFill} style={style({ '--v': avg })} />
                  <span className={styles.catTick} style={style({ '--v': 0.49 })} />
                </span>
                <span className={styles.catPct} data-band={bandOf(avg)}>
                  {Math.round(avg * 100)}%
                </span>
              </span>
              <span className={styles.num}>{items}</span>
              <span className={styles.num}>{Math.round(pass * 100)}%</span>
              <span className={styles.num}>{lat}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────────── P5: item details ───────────────────────────── */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const isObj = (v: Json): v is { [k: string]: Json } => !!v && typeof v === 'object' && !Array.isArray(v);

function preview(v: Json): string {
  if (Array.isArray(v)) return `array · ${v.length} ${v.length === 1 ? 'item' : 'items'}`;
  if (isObj(v)) {
    const n = Object.keys(v).length;
    return `object · ${n} ${n === 1 ? 'key' : 'keys'}`;
  }
  return String(v);
}

/** Open-state registry: a path set, so Expand all / Collapse all are one operation on every level. */
function paths(v: Json, base: string, out: string[] = []): string[] {
  if (isObj(v))
    Object.entries(v).forEach(([k, c]) => (out.push(`${base}/${k}`), paths(c, `${base}/${k}`, out)));
  else if (Array.isArray(v)) v.forEach((c, i) => (out.push(`${base}/${i}`), paths(c, `${base}/${i}`, out)));
  return out;
}

function KeyRow({
  name,
  value,
  path,
  open,
  toggle,
  setMany,
  depth,
}: {
  name: string;
  value: Json;
  path: string;
  open: Set<string>;
  toggle: (p: string) => void;
  setMany: (ps: string[], on: boolean) => void;
  depth: number;
}) {
  const nested = isObj(value) || Array.isArray(value);
  const isOpen = open.has(path);
  const kids = nested ? paths(value, path) : [];
  return (
    <div className={styles.keyRow} data-depth={depth} data-open={isOpen ? '' : undefined}>
      <div className={styles.keyHead}>
        <button type="button" className={styles.keyBtn} aria-expanded={isOpen} onClick={() => toggle(path)}>
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
          <span className={styles.keyName}>{name}</span>
          {isOpen && nested ? (
            <span className={styles.keyType}>{preview(value)}</span>
          ) : (
            <span className={styles.keyPreview} dir="auto">
              {preview(value)}
            </span>
          )}
        </button>
        {isOpen && nested && kids.length ? (
          <span className={styles.keyActions}>
            <Button variant="ghost" size="sm" onPress={() => setMany(kids, true)}>
              Expand all
            </Button>
            <Button variant="ghost" size="sm" onPress={() => setMany(kids, false)}>
              Collapse all
            </Button>
          </span>
        ) : null}
        {isOpen ? <CopyButton text={JSON.stringify(value)} label={`Copy ${name}`} /> : null}
      </div>
      {isOpen ? (
        <div className={styles.keyBody}>
          {isObj(value) ? (
            Object.entries(value).map(([k, c]) => (
              <KeyRow
                key={k}
                name={k}
                value={c}
                path={`${path}/${k}`}
                open={open}
                toggle={toggle}
                setMany={setMany}
                depth={depth + 1}
              />
            ))
          ) : Array.isArray(value) ? (
            value.map((c, i) => (
              <KeyRow
                key={i}
                name={`[${i}]`}
                value={c}
                path={`${path}/${i}`}
                open={open}
                toggle={toggle}
                setMany={setMany}
                depth={depth + 1}
              />
            ))
          ) : (
            <p className={styles.valueText} dir="auto">
              {String(value)}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function OutputBlock({
  id,
  value,
  open,
  toggle,
  setMany,
}: {
  id: string;
  value: { [k: string]: Json };
  open: Set<string>;
  toggle: (p: string) => void;
  setMany: (ps: string[], on: boolean) => void;
}) {
  return (
    <div className={styles.outBlock}>
      {Object.entries(value).map(([k, v]) => (
        <KeyRow
          key={k}
          name={k}
          value={v}
          path={`${id}/${k}`}
          open={open}
          toggle={toggle}
          setMany={setMany}
          depth={0}
        />
      ))}
    </div>
  );
}

const EN_OUT = (p: number): { [k: string]: Json } => ({
  answer: `Answer ${p} for 0: clause 0 requires written approval.`,
  reasoning: 'Looked up the clause then summarised it.',
  citations: [
    { doc: 'policy', page: 3, score: 0.9 },
    { doc: 'guide', page: 4, score: 0.6 },
  ],
  meta: { nested: { a: [1, 2, { b: 'deep' }], c: { d: 'e' } }, tags: ['x', 'y'] },
  confidence: 0.7,
});
const AR_OUT = (p: number): { [k: string]: Json } => ({
  answer: `الإجابة رقم ${p}: التمويل العقاري يتطلب مستندات إثبات الدخل وعقد الشراء.`,
  reasoning: 'حللت السؤال ثم استرجعت المستندات ذات الصلة وصغت الإجابة اعتماداً عليها.',
  citations: [
    { doc: 'policy-2026', page: 3, score: 0.91 },
    { doc: 'products-guide', page: 4, score: 0.62 },
  ],
  sql: 'SELECT name, SUM(total) FROM orders GROUP BY name LIMIT 10',
  followups: ['هل تريد التفاصيل؟', 'هل تحتاج مثالاً؟'],
});

const PASS_OK = [false, true, true, false, true, true, true, false, true, true];

const MET_ROWS: Array<{ name: string; vals: number[]; bool?: boolean; meta?: boolean }> = [
  { name: 'correct', vals: PASS_OK.map((v) => (v ? 1 : 0)), bool: true },
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `rubric_metric_${String(i + 1).padStart(2, '0')}`,
    meta: i === 0,
    vals: Array.from({ length: 10 }, (_, p) =>
      Math.min(0.99, Math.max(0.12, 0.3 + ((i * 7 + p * 13) % 61) / 100)),
    ),
  })),
];

export function ItemDetailsMock({ variant }: { variant: 'en1' | 'ar10' | 'en10' }) {
  const arabic = variant === 'ar10';
  const passes = variant === 'en1' ? 1 : 10;
  const [shown, setShown] = useState<number[]>([1, 2, 3]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [pick, setPick] = useState<{ metric: string; pass: number } | null>(
    passes > 1 ? { metric: 'rubric_metric_01', pass: 3 } : { metric: 'rubric_metric_01', pass: 1 },
  );
  const [moreMetrics, setMoreMetrics] = useState(false);
  const [view, setView] = useState<'sections' | 'raw'>('sections');
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const setMany = (ps: string[], on: boolean) =>
    setOpen((s) => {
      const n = new Set(s);
      ps.forEach((p) => (on ? n.add(p) : n.delete(p)));
      return n;
    });
  const outFor = (p: number) => (arabic ? AR_OUT(p) : EN_OUT(p));
  const allPaths = (ids: number[]) =>
    ids.flatMap((p) =>
      Object.entries(outFor(p)).flatMap(([k, v]) => [`p${p}/${k}`, ...paths(v, `p${p}/${k}`)]),
    );
  const inputText = arabic
    ? 'ما هي شروط الحصول على تمويل عقاري وفق الضوابط الحالية؟ اذكر المستندات المطلوبة والحد الأقصى لنسبة الاستقطاع.'
    : 'Question 0: summarise clause 0 of the finance policy and list who must approve it.';
  const expectedText = arabic ? 'الرياض' : 'Clause 0 requires written approval from the finance lead.';
  const passedCount = PASS_OK.filter(Boolean).length;
  const rows = moreMetrics ? MET_ROWS : MET_ROWS.slice(0, 8);
  const cols = passes === 1 ? [1] : shown;
  return (
    <article className={styles.item} aria-label="Item #1" data-r3={`item-${variant}`}>
      <header className={styles.itemBar}>
        <span className={styles.itemNum}>#1</span>
        <Tag tone={passes === 1 ? 'danger' : 'warning'}>
          {passes === 1 ? 'Fail' : `${passedCount} of 10 passed`}
        </Tag>
        <span className={styles.itemBarInput} dir="auto">
          {inputText}
        </span>
        <span className={styles.itemBarActions}>
          <CopyButton text="#1" label="Copy link" icon="link" />
          <Button variant="neutral" size="sm" iconEnd={<Icon name="chevron-up" size={14} />}>
            Collapse
          </Button>
        </span>
      </header>

      <section className={styles.region} aria-label="Input">
        <h3 className={styles.regionLabel}>Input</h3>
        <div className={styles.regionBody}>
          <p className={styles.valueText} dir="auto" data-testid="r3-input">
            {inputText}
          </p>
        </div>
        <span className={styles.regionActions}>
          <CopyButton text={inputText} label="Copy input" />
        </span>
      </section>
      <section className={styles.region} aria-label="Expected output">
        <h3 className={styles.regionLabel}>Expected</h3>
        <div className={styles.regionBody}>
          <p className={styles.valueText} dir="auto">
            {expectedText}
          </p>
        </div>
        <span className={styles.regionActions}>
          <CopyButton text={expectedText} label="Copy expected output" />
        </span>
      </section>
      <section className={styles.region} aria-label="Item metadata">
        <h3 className={styles.regionLabel}>Tags</h3>
        <div className={styles.regionBody}>
          <span className={styles.tagRow}>
            <Tag kind="data">complexity: easy</Tag>
            <Tag kind="data">domain: finance</Tag>
            {arabic ? <Tag kind="data">lang: ar</Tag> : null}
          </span>
        </div>
      </section>

      <section className={styles.outputRegion} aria-label="Output">
        <div className={styles.regionHead}>
          <h3 className={styles.regionTitle}>Output</h3>
          <span className={styles.regionHeadMeta}>
            {passes === 1 ? '1.9s · 4 keys' : `${cols.length} of 10 passes shown`}
          </span>
          <span className={styles.regionHeadActions}>
            <SegmentedControl
              label="Output view"
              value={view}
              onChange={setView}
              options={[
                { value: 'sections', label: 'Sections' },
                { value: 'raw', label: 'Raw' },
              ]}
            />
            <Button variant="ghost" size="sm" onPress={() => setMany(allPaths(cols), true)}>
              Expand all
            </Button>
            <Button variant="ghost" size="sm" onPress={() => setMany(allPaths(cols), false)}>
              Collapse all
            </Button>
          </span>
        </div>
        {passes > 1 ? (
          <div className={styles.passRail} role="group" aria-label="Passes shown">
            {PASS_OK.map((ok, i) => (
              <Chip
                key={i}
                tone={ok ? 'success' : 'danger'}
                isSelected={shown.includes(i + 1)}
                onChange={(on) =>
                  setShown((s) =>
                    on
                      ? [...s, i + 1].sort((a, b) => a - b)
                      : s.length > 1
                        ? s.filter((x) => x !== i + 1)
                        : s,
                  )
                }
                aria-label={`Pass ${i + 1}, ${ok ? 'passed' : 'failed'}`}
              >
                <span className={styles.passChip}>
                  <span className={styles.mono}>{i + 1}</span>
                  <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
                </span>
              </Chip>
            ))}
            <span className={styles.passHelp}>Select up to 3 passes to read side by side.</span>
          </div>
        ) : null}
        <div className={styles.passGrid} data-n={cols.length}>
          {cols.map((p) => (
            <div key={p} className={styles.passCol} data-rail={passes === 1 ? 'danger' : undefined}>
              {passes > 1 ? (
                <div className={styles.passHead}>
                  <Tag kind="count">Pass {p}</Tag>
                  <Tag tone={PASS_OK[p - 1] ? 'success' : 'danger'}>{PASS_OK[p - 1] ? 'Pass' : 'Fail'}</Tag>
                  <span className={styles.passMeta}>{(1.2 + p / 7).toFixed(1)}s</span>
                  <span className={styles.passHeadActions}>
                    <Button variant="neutral" size="sm" icon={<Icon name="list" size={14} />}>
                      Trace
                    </Button>
                  </span>
                </div>
              ) : null}
              {view === 'raw' ? (
                <pre className={styles.raw}>{JSON.stringify(outFor(p), null, 2)}</pre>
              ) : (
                <OutputBlock id={`p${p}`} value={outFor(p)} open={open} toggle={toggle} setMany={setMany} />
              )}
            </div>
          ))}
        </div>
      </section>

      <hr className={styles.divider} />

      <section className={styles.metricsRegion} aria-label="Metrics">
        <div className={styles.regionHead}>
          <h3 className={styles.regionTitle}>Metrics</h3>
          <span className={styles.regionHeadMeta}>
            {MET_ROWS.length} shown of 24 ·{' '}
            {passes === 1 ? '3 below threshold' : '1 metric differs across passes'}
          </span>
        </div>
        <div className={styles.matrixWrap}>
          <div
            role="table"
            aria-label="Metrics by pass"
            className={styles.matrix}
            style={style({ '--np-all': 10, '--np-shown': cols.length })}
          >
            <div role="rowgroup">
              <div
                role="row"
                className={styles.mrow}
                data-head=""
                data-single={passes === 1 ? '' : undefined}
              >
                <div role="columnheader">Metric</div>
                {(passes === 1 ? [1] : Array.from({ length: 10 }, (_, i) => i + 1)).map((p) => (
                  <div
                    role="columnheader"
                    key={p}
                    data-num=""
                    data-pass={p}
                    data-shown={cols.includes(p) ? '' : undefined}
                  >
                    {passes === 1 ? 'Score' : p}
                  </div>
                ))}
                {passes > 1 ? (
                  <div role="columnheader" data-num="">
                    Mean
                  </div>
                ) : (
                  <div role="columnheader" data-reason="">
                    Reason
                  </div>
                )}
              </div>
            </div>
            <div role="rowgroup">
              {rows.map((r) => {
                const vals = passes === 1 ? [r.vals[0]!] : r.vals;
                const mean = r.vals.reduce((a, b) => a + b, 0) / r.vals.length;
                return (
                  <div
                    role="row"
                    key={r.name}
                    className={styles.mrow}
                    data-single={passes === 1 ? '' : undefined}
                  >
                    <div role="rowheader" className={styles.rowHead}>
                      <span className={styles.metricName}>{r.name}</span>
                    </div>
                    {vals.map((v, p) => (
                      <div
                        role="cell"
                        key={p}
                        data-num=""
                        data-pass={p + 1}
                        data-shown={cols.includes(p + 1) ? '' : undefined}
                      >
                        <button
                          type="button"
                          className={styles.cell}
                          data-selected={pick?.metric === r.name && pick.pass === p + 1 ? '' : undefined}
                          data-band={r.bool ? (v ? 5 : 1) : bandOf(v)}
                          aria-label={`${r.name}, pass ${p + 1}: ${r.bool ? (v ? 'True' : 'False') : `${Math.round(v * 100)}%`}`}
                          onClick={() => setPick({ metric: r.name, pass: p + 1 })}
                        >
                          {r.bool ? (v ? 'True' : 'False') : `${Math.round(v * 100)}%`}
                        </button>
                      </div>
                    ))}
                    {passes > 1 ? (
                      <div role="cell" data-num="">
                        <span className={styles.mean}>{`${Math.round(mean * 100)}%`}</span>
                      </div>
                    ) : (
                      <div role="cell" data-reason="" dir="auto">
                        {r.meta || r.bool ? 'Covers most of the required points.' : '—'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={styles.moreMetrics}
          onPress={() => setMoreMetrics((v) => !v)}
        >
          {moreMetrics ? 'Show fewer metrics' : `Show ${MET_ROWS.length - 8} more metrics`}
        </Button>
        {pick ? (
          <div className={styles.metricDetail} aria-label={`${pick.metric} detail`}>
            <div className={styles.detailHead}>
              <span className={styles.metricName}>{pick.metric}</span>
              {passes > 1 ? <Tag kind="count">Pass {pick.pass}</Tag> : null}
              <span className={styles.detailActions}>
                <IconButton label="Edit score" icon="edit" />
                <IconButton label="Close detail" icon="close" onPress={() => setPick(null)} />
              </span>
            </div>
            <dl className={styles.detailGrid}>
              <dt>Reason</dt>
              <dd dir="auto">
                {arabic ? 'يغطي معظم النقاط المطلوبة' : 'Covers most of the required points.'}
              </dd>
              <dt>Judge model</dt>
              <dd className={styles.mono}>gpt-5</dd>
              <dt>Confidence</dt>
              <dd className={styles.mono}>0.7</dd>
            </dl>
          </div>
        ) : null}
      </section>
    </article>
  );
}

/* ───────────────────────────── P7: distribution box plots ───────────────────────────── */

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

const quant = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

interface BoxStats {
  n: number;
  min: number;
  p5: number;
  p25: number;
  med: number;
  mean: number;
  p75: number;
  p95: number;
  max: number;
  sum: number;
  low: number[];
  high: number[];
}

function boxStats(values: number[]): BoxStats {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const wide = n >= 20;
  const p5 = wide ? quant(v, 0.05) : v[0]!;
  const p95 = wide ? quant(v, 0.95) : v[n - 1]!;
  const sum = v.reduce((a, b) => a + b, 0);
  const cap = (xs: number[]) => {
    if (xs.length <= 40) return xs;
    const out = [xs[0]!];
    for (let i = 1; i < 39; i++) out.push(xs[Math.round((i * (xs.length - 1)) / 39)]!);
    out.push(xs[xs.length - 1]!);
    return out;
  };
  return {
    n,
    min: v[0]!,
    p5,
    p25: quant(v, 0.25),
    med: quant(v, 0.5),
    mean: sum / n,
    p75: quant(v, 0.75),
    p95,
    max: v[n - 1]!,
    sum,
    low: wide ? cap(v.filter((x) => x < p5)) : [],
    high: wide ? cap(v.filter((x) => x > p95)) : [],
  };
}

const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);
const fmtInt = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v * 10) / 10));
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

function niceAxis(max: number, maxTicks = 5): { domain: [number, number]; ticks: number[] } {
  const raw = max / (maxTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { domain: [0, top], ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

const niceTicks = (lo: number, hi: number, n = 4) =>
  Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

/** Box plot drawn at the measured width: whiskers p5..p95, box p25..p75, median line, mean diamond, outside points as dots. */
function BoxPlotSvg({
  st,
  fmt,
  domain,
  ticks: tickValues,
  tailTone,
  name,
}: {
  st: BoxStats;
  fmt: (v: number) => string;
  domain: [number, number];
  ticks?: number[];
  tailTone?: boolean;
  name: string;
}) {
  const [ref, W] = useMeasuredWidth<HTMLDivElement>(320);
  const H = 84;
  const padX = 14;
  const cy = 36;
  const bh = 24;
  const sx = (v: number) => padX + ((v - domain[0]) / (domain[1] - domain[0] || 1)) * (W - 2 * padX);
  const ticks = tickValues ?? niceTicks(domain[0], domain[1], W < 320 ? 2 : 4);
  const medX = sx(st.med);
  const labelAnchor = medX < 40 ? 'start' : medX > W - 40 ? 'end' : 'middle';
  return (
    <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={styles.box} role="img" aria-label={name}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={styles.grid} x1={sx(t)} x2={sx(t)} y1={cy - 22} y2={H - 22} />
            <text
              className={styles.tick}
              x={sx(t)}
              y={H - 6}
              textAnchor={t === domain[0] ? 'start' : t === domain[1] ? 'end' : 'middle'}
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        <line className={styles.whisker} x1={sx(st.p5)} x2={sx(st.p95)} y1={cy} y2={cy} />
        <line className={styles.cap} x1={sx(st.p5)} x2={sx(st.p5)} y1={cy - 7} y2={cy + 7} />
        <line className={styles.cap} x1={sx(st.p95)} x2={sx(st.p95)} y1={cy - 7} y2={cy + 7} />
        {st.low.map((v, i) => (
          <circle key={`l${i}`} className={styles.outlier} cx={sx(v)} cy={cy} r={2.5} />
        ))}
        {st.high.map((v, i) => (
          <circle
            key={`h${i}`}
            className={styles.outlier}
            data-tail={tailTone ? '' : undefined}
            cx={sx(v)}
            cy={cy}
            r={2.5}
          />
        ))}
        <rect
          className={styles.iqr}
          x={sx(st.p25)}
          y={cy - bh / 2}
          width={Math.max(3, sx(st.p75) - sx(st.p25))}
          height={bh}
          rx={3}
        />
        <line className={styles.median} x1={medX} x2={medX} y1={cy - bh / 2} y2={cy + bh / 2} />
        <path
          className={styles.meanMark}
          d={`M${sx(st.mean)},${cy - 5}L${sx(st.mean) + 5},${cy}L${sx(st.mean)},${cy + 5}L${sx(st.mean) - 5},${cy}Z`}
        />
        <text className={styles.medianLabel} x={medX} y={cy - bh / 2 - 6} textAnchor={labelAnchor}>
          {fmt(st.med)}
        </text>
      </svg>
    </div>
  );
}

function BoxNumbers({ st, fmt, total }: { st: BoxStats; fmt: (v: number) => string; total?: string }) {
  const cells: Array<[string, string, string?]> = [
    ['Min', fmt(st.min)],
    ['P25', fmt(st.p25)],
    ['Median', fmt(st.med)],
    ['Mean', fmt(st.mean), 'mean'],
    ['P75', fmt(st.p75)],
    ['Max', fmt(st.max)],
  ];
  if (total) cells.push(['Total', total, 'total']);
  return (
    <dl className={styles.boxNums} data-total={total ? '' : undefined} aria-label="Distribution values">
      {cells.map(([k, v, kind]) => (
        <div key={k} className={styles.boxNum} data-kind={kind}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function BoxLegend() {
  return (
    <ul className={styles.boxLegend} aria-label="How to read the box plot">
      <li>
        <span className={styles.lgBox} aria-hidden="true" />
        middle 50%
      </li>
      <li>
        <span className={styles.lgWhisker} aria-hidden="true" />
        p5 to p95
      </li>
      <li>
        <span className={styles.lgMedian} aria-hidden="true" />
        median
      </li>
      <li>
        <span className={styles.lgMean} aria-hidden="true" />
        mean
      </li>
      <li>
        <span className={styles.lgDot} aria-hidden="true" />
        outside p5 to p95
      </li>
    </ul>
  );
}

export function BoxPlotsMock() {
  const r = mulberry(7);
  const latency = Array.from({ length: 237 }, () => Math.exp(7.35 + 0.55 * gauss(r)));
  const tokens = Array.from({ length: 237 }, (_, i) =>
    i % 20 === 3 ? 0 : Math.max(0, Math.round(520 + 190 * gauss(r))),
  );
  const score = Array.from({ length: 237 }, () => Math.min(1, Math.max(0, 0.5 + 0.2 * gauss(r))));
  const sl = boxStats(latency);
  const stt = boxStats(tokens);
  const ss = boxStats(score);
  const pass = [1, 2, 3, 4, 5].map((p) => {
    const rr = mulberry(p * 11);
    return boxStats(
      Array.from({ length: 24 }, () => Math.min(1, Math.max(0, 0.45 + p * 0.03 + 0.18 * gauss(rr)))),
    );
  });
  return (
    <div className={styles.boxGrid} data-r3="box-plots">
      <ChartCard
        title="Response time"
        meta="237 items"
        value={<span className={styles.mono}>{fmtMs(sl.mean)}</span>}
        note="Mean, end to end per item"
      >
        <BoxPlotSvg
          st={sl}
          fmt={fmtMs}
          domain={niceAxis(sl.max).domain}
          ticks={niceAxis(sl.max).ticks}
          tailTone
          name={`Response time, 237 items: min ${fmtMs(sl.min)}, median ${fmtMs(sl.med)}, mean ${fmtMs(sl.mean)}, max ${fmtMs(sl.max)}`}
        />
        <BoxNumbers st={sl} fmt={fmtMs} />
        <BoxLegend />
      </ChartCard>
      <ChartCard
        title="tokens_used"
        meta="237 items"
        value={<span className={styles.mono}>{fmtInt(stt.mean)}</span>}
        note="12 task errors, counted as 0 in Mean and Min"
      >
        <BoxPlotSvg
          st={stt}
          fmt={fmtInt}
          domain={niceAxis(stt.max).domain}
          ticks={niceAxis(stt.max).ticks}
          name={`tokens_used, 237 items: min ${fmtInt(stt.min)}, median ${fmtInt(stt.med)}, mean ${fmtInt(stt.mean)}, max ${fmtInt(stt.max)}, total ${fmtInt(stt.sum)}`}
        />
        <BoxNumbers st={stt} fmt={fmtInt} total={fmtInt(stt.sum)} />
        <BoxLegend />
      </ChartCard>
      <ChartCard
        title="quality"
        meta="217 scored · 20 err"
        band={2}
        value={<ScoreValue value={ss.mean} type="percentage" direction="maximize" />}
        note="8 scorer errors and 12 task errors, counted as 0%"
      >
        <BoxPlotSvg
          st={ss}
          fmt={(v) => `${Math.round(v * 100)}%`}
          domain={[0, 1]}
          name={`quality, 217 scored: min ${fmtPct(ss.min)}, median ${fmtPct(ss.med)}, mean ${fmtPct(ss.mean)}, max ${fmtPct(ss.max)}`}
        />
        <BoxNumbers st={ss} fmt={fmtPct} />
        <BoxLegend />
      </ChartCard>
      <Card
        as="section"
        aria-label="Quality by pass"
        className={styles.byPass}
        header={
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>Quality by pass</span>
            <Tag kind="count">5 passes · 24 items each</Tag>
          </div>
        }
      >
        <div className={styles.passRows} role="group" aria-label="Quality distribution by pass">
          {pass.map((st, i) => (
            <PassBoxRow key={i} n={i + 1} st={st} />
          ))}
          <div className={styles.passAxis} aria-hidden="true">
            {[0, 25, 50, 75, 100].map((t) => (
              <span key={t} style={style({ '--x': t / 100 })}>
                {t}%
              </span>
            ))}
          </div>
        </div>
        <BoxLegend />
      </Card>
    </div>
  );
}

function PassBoxRow({ n, st }: { n: number; st: BoxStats }) {
  const x = (v: number) => `${v * 100}%`;
  return (
    <button
      type="button"
      className={styles.passRow}
      aria-label={`Pass ${n}: median ${fmtPct(st.med)}, mean ${fmtPct(st.mean)}, middle half ${fmtPct(st.p25)} to ${fmtPct(st.p75)}, filter to this pass`}
    >
      <span className={styles.passTag}>
        <Tag kind="count">Pass {n}</Tag>
      </span>
      <span className={styles.passTrack}>
        <span className={styles.rWhisker} style={style({ '--a': x(st.p5), '--b': x(st.p95) })} />
        <span className={styles.rBox} style={style({ '--a': x(st.p25), '--b': x(st.p75) })} />
        <span className={styles.rMedian} style={style({ '--a': x(st.med) })} />
        <span className={styles.rMean} style={style({ '--a': x(st.mean) })} />
      </span>
      <span className={styles.passMed}>{fmtPct(st.med)}</span>
    </button>
  );
}

/* ───────────────────────────── gallery wrapper ───────────────────────────── */

export function Round3Mocks({
  Section,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Section id="round3" title="Round 3 run-detail mocks (design contract)">
      <Case
        wide
        label="r3-run-header (P6: details visible, 1440 width; chips clamp to 2 lines, then + N more)"
      >
        <RunHeaderMock />
      </Case>
      <Case wide label="r3-chart-cards (P1)">
        <ChartCardsMock />
      </Case>
      <Case wide label="r3-repeat-panel (P2)">
        <RepeatPanelMock />
      </Case>
      <Case wide label="r3-categories (P3)">
        <CategoriesMock />
      </Case>
      <Case wide label="r3-box-plots (P7: distribution box plots replace min / avg / max / total)">
        <BoxPlotsMock />
      </Case>
      <Case wide label="r3-item-details-en (P5: single pass, English)">
        <ItemDetailsMock variant="en1" />
      </Case>
      <Case wide label="r3-item-details-ar10 (P5: Arabic, 10 passes)">
        <ItemDetailsMock variant="ar10" />
      </Case>
    </Section>
  );
}
