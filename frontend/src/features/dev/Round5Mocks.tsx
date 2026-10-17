/**
 * Round 5 run-detail mocks (design stage): static, hand-fed visual contracts for
 * docs/internal/ui-migration/redesign5/run-detail.md. Primitives and tokens only; nothing here reads the API.
 * Cases: r5-bars-10, r5-bars-20 (R1), r5-box-coloured (R2), r5-metric-panel-en, -ar, -table (R3).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Card, DataTable, HelpMarker, Icon, IconButton, ScoreValue, Tag, type Column } from '@/ui';
import { useMeasuredWidth } from '@/features/run-detail/components/charts/Charts';
import styles from './Round5Mocks.module.css';

const style = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ───────────────────────────── R1: bar columns ───────────────────────────── */

interface Bar {
  label: string;
  count: number;
  band?: 1 | 2 | 3 | 4 | 5;
  sub?: string;
}

const GAP = 4;
const CHAR_PX = 7; // one mono digit at --font-sm

/**
 * The fixed recipe. A column is a two-row grid: the well (spacer, count, bar; its bottom border is the x axis) and a foot
 * of constant height (axis label, optional sub label). The foot is always rendered, even for a thinned label, so no column
 * can end higher or lower than its neighbours: every bar bottom is the axis line.
 */
function Bars({ bars, name, zero = 'hide' }: { bars: Bar[]; name: string; zero?: 'hide' | 'show' }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>(240);
  const n = bars.length;
  const pitch = (w - GAP * (n - 1)) / n + GAP;
  const labelW = Math.max(...bars.map((b) => b.label.length)) * CHAR_PX + 6;
  const every = Math.max(1, Math.ceil(labelW / pitch));
  const countW = Math.max(...bars.map((b) => String(b.count).length)) * CHAR_PX + 2;
  const dense = pitch < countW;
  const max = Math.max(1, ...bars.map((b) => b.count));
  const rows = bars.some((b) => b.sub) ? 2 : 1;
  return (
    <div ref={ref} className={styles.plotBox}>
      <div
        className={styles.plot}
        role="group"
        aria-label={name}
        data-dense={dense ? '' : undefined}
        style={style({ '--foot': `${4 + 14 * rows}px` })}
      >
        {bars.map((b, i) => (
          <div
            key={b.label}
            className={styles.col}
            data-band={b.band}
            data-zero={b.count === 0 ? '' : undefined}
            data-tier={dense && i % 2 === 1 ? '2' : undefined}
            style={style({ '--p': b.count / max })}
          >
            <div className={styles.well}>
              <span className={styles.count} aria-hidden="true">
                {b.count === 0 ? (zero === 'show' ? '0' : '') : b.count}
              </span>
              <span className={styles.bar} />
            </div>
            <div className={styles.foot} aria-hidden="true">
              <span className={styles.axis}>{i % every === 0 ? b.label : ' '}</span>
              {rows === 2 ? <span className={styles.sub}>{b.sub ?? ' '}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  meta,
  band,
  intro,
  children,
  slim,
  help,
}: {
  title: string;
  meta?: ReactNode;
  band?: 1 | 2 | 3 | 4 | 5;
  intro?: ReactNode;
  children: ReactNode;
  slim?: boolean;
  help?: boolean;
}) {
  return (
    <Card
      as="section"
      fill
      aria-label={title}
      band={band}
      className={slim ? styles.w279 : undefined}
      header={
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>{title}</span>
          {meta ? <span className={styles.headRight}>{meta}{help ? <HelpMarker label="How to read the box plot">{HOW}</HelpMarker> : null}</span> : null}
        </div>
      }
    >
      {intro ? <div className={styles.intro}>{intro}</div> : null}
      <div className={styles.slot}>{children}</div>
    </Card>
  );
}

const TONES: Bar['band'][] = [1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5];
const hist = (counts: number[]): Bar[] =>
  counts.map((count, i) => ({ label: `${i * 10}%`, count, band: TONES[i] }));

export function BarsMock10() {
  return (
    <div className={styles.cardGrid} data-r5="bars-10">
      <ChartCard
        title="quality"
        band={3}
        meta={<Tag kind="count">86 scored</Tag>}
        intro={<ScoreValue value={0.659} type="percentage" direction="maximize" variant="text" />}
      >
        <Bars name="quality score distribution" bars={hist([2, 3, 5, 4, 6, 7, 9, 22, 14, 8, 6])} />
      </ChartCard>
      <ChartCard
        title="faithfulness"
        band={3}
        meta={<Tag kind="count">86 scored</Tag>}
        intro={<ScoreValue value={0.663} type="percentage" direction="maximize" variant="text" />}
      >
        <Bars name="faithfulness score distribution" bars={hist([2, 5, 4, 6, 4, 6, 9, 19, 18, 7, 6])} />
      </ChartCard>
      <ChartCard
        title="correct"
        band={3}
        meta={<Tag kind="count">86 items</Tag>}
        intro={<ScoreValue value={0.686} type="percentage" direction="maximize" variant="text" />}
      >
        <Bars
          name="correct pass and fail split"
          zero="show"
          bars={[
            { label: 'Pass', count: 59, band: 5, sub: '69%' },
            { label: 'Fail', count: 27, band: 1, sub: '31%' },
          ]}
        />
      </ChartCard>
      <ChartCard
        title="rubric_judge"
        band={3}
        meta={<Tag kind="count">86 scored</Tag>}
        intro={<ScoreValue value={0.657} type="percentage" direction="maximize" variant="text" />}
      >
        <Bars name="rubric_judge score distribution" bars={hist([3, 2, 7, 2, 6, 8, 11, 17, 17, 11, 2])} />
      </ChartCard>
    </div>
  );
}

const PASSES_PASSED = [1, 0, 0, 1, 0, 2, 3, 2, 5, 6, 9, 8, 7, 12, 9, 6, 5, 3, 1, 1];
const passBars = (): Bar[] =>
  PASSES_PASSED.map((count, i) => ({
    label: String(i),
    count,
    band: i === 0 ? 1 : i === PASSES_PASSED.length - 1 ? 5 : undefined,
  }));

const LATENCY = [17, 22, 9, 11, 11, 5, 2, 2, 1, 2, 3, 1, 0, 0, 1, 0];
const latBars = (): Bar[] =>
  LATENCY.map((count, i) => ({ label: `${i}`, count, band: i < 6 ? undefined : i < 9 ? 3 : 2 }));

export function BarsMock20() {
  return (
    <div className={styles.cardGrid} data-r5="bars-20">
      <ChartCard title="Passes passed" meta={<Tag kind="count">19 passes · 80 items</Tag>}>
        <Bars name="Items by number of passes that passed" bars={passBars()} zero="show" />
      </ChartCard>
      <ChartCard title="Passes passed (narrow column)" slim meta={<Tag kind="count">19 passes</Tag>}>
        <Bars name="Items by number of passes that passed" bars={passBars()} zero="show" />
      </ChartCard>
      <ChartCard title="Response time (16 bins)" meta={<Tag kind="count">86 items</Tag>}>
        <Bars name="Latency histogram" bars={latBars()} />
      </ChartCard>
    </div>
  );
}

/* ───────────────────────────── R2: coloured box plots ───────────────────────────── */

interface Stats {
  min: number;
  p5: number;
  p25: number;
  med: number;
  mean: number;
  p75: number;
  p95: number;
  max: number;
  low: number[];
  high: number[];
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);

const QUALITY: Stats = { min: 0.08, p5: 0.18, p25: 0.52, med: 0.71, mean: 0.66, p75: 0.84, p95: 0.96, max: 1, low: [0.08, 0.12, 0.15], high: [] };
const QUALITY_LOW: Stats = { min: 0.0, p5: 0.04, p25: 0.15, med: 0.31, mean: 0.34, p75: 0.52, p95: 0.78, max: 0.9, low: [], high: [0.84, 0.9] };
const LATENCY_STATS: Stats = { min: 501, p5: 760, p25: 1500, med: 2300, mean: 3300, p75: 4500, p95: 9700, max: 11800, low: [], high: [10100, 10600, 11800] };
const TOKENS: Stats = { min: 321, p5: 410, p25: 549.5, med: 724, mean: 743.9, p75: 958, p95: 1140, max: 1193, low: [], high: [1170, 1193] };

const bandOfMedian = (v: number): 1 | 2 | 3 | 4 | 5 => (v < 0.4 ? 1 : v < 0.6 ? 2 : v < 0.75 ? 3 : v < 0.9 ? 4 : 5);

/**
 * The coloured glyph: box, median, mean and whiskers share one tone (`--tone`, set by data-band or data-series); no number
 * row. The median is printed above its line, the data minimum and maximum under the baseline ends; the other four numbers
 * live in the tooltip and the aria-label.
 */
function BoxGlyph({
  s,
  domain,
  fmt,
  name,
  tone,
  tail,
}: {
  s: Stats;
  domain: [number, number];
  fmt: (v: number) => string;
  name: string;
  tone: { band?: number; series?: number };
  tail?: boolean;
}) {
  const [ref, W] = useMeasuredWidth<HTMLDivElement>(260);
  const px = 14;
  const sx = (v: number) => px + ((v - domain[0]) / (domain[1] - domain[0])) * (W - 2 * px);
  const cy = 34;
  const bh = 24;
  const base = 62;
  const minX = sx(s.min);
  const maxX = sx(s.max);
  const minText = fmt(s.min);
  const maxText = fmt(s.max);
  const merge = maxX - minX < (minText.length + maxText.length) * 6.6 + 16;
  const medX = sx(s.med);
  const diamond = `M${sx(s.mean)},${cy - 5}L${sx(s.mean) + 5},${cy}L${sx(s.mean)},${cy + 5}L${sx(s.mean) - 5},${cy}Z`;
  return (
    <div ref={ref} className={styles.glyphBox} data-band={tone.band} data-series={tone.series}>
      <svg width={W} height={80} viewBox={`0 0 ${W} 80`} role="img" aria-label={name} className={styles.glyph}>
        <line className={styles.axisLine} x1={sx(domain[0])} x2={sx(domain[1])} y1={base} y2={base} />
        <line className={styles.axisTick} x1={sx(domain[0])} x2={sx(domain[0])} y1={base - 3} y2={base + 3} />
        <line className={styles.axisTick} x1={sx(domain[1])} x2={sx(domain[1])} y1={base - 3} y2={base + 3} />
        <line className={styles.whisker} x1={sx(s.p5)} x2={sx(s.p95)} y1={cy} y2={cy} />
        <line className={styles.whisker} x1={sx(s.p5)} x2={sx(s.p5)} y1={cy - 7} y2={cy + 7} />
        <line className={styles.whisker} x1={sx(s.p95)} x2={sx(s.p95)} y1={cy - 7} y2={cy + 7} />
        {[...s.low, ...s.high].map((v) => (
          <circle
            key={v}
            className={styles.dot}
            data-tail={tail && v > s.p95 ? '' : undefined}
            cx={sx(v)}
            cy={cy}
            r={v === s.min || v === s.max ? 3 : 2.5}
          />
        ))}
        <rect className={styles.iqr} x={sx(s.p25)} y={cy - bh / 2} width={Math.max(3, sx(s.p75) - sx(s.p25))} height={bh} rx={3} />
        <line className={styles.median} x1={medX} x2={medX} y1={cy - bh / 2} y2={cy + bh / 2} />
        <path className={styles.mean} d={diamond} />
        <text className={styles.medLabel} x={medX} y={cy - bh / 2 - 6} textAnchor="middle">
          {fmt(s.med)}
        </text>
        {merge ? (
          <text className={styles.endLabel} x={(minX + maxX) / 2} y={base + 16} textAnchor="middle">
            {minText} to {maxText}
          </text>
        ) : (
          <>
            <text className={styles.endLabel} x={Math.max(0, minX - 3)} y={base + 16} textAnchor="start">
              {minText}
            </text>
            <text className={styles.endLabel} x={Math.min(W, maxX + 3)} y={base + 16} textAnchor="end">
              {maxText}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

function Tip({ s, fmt }: { s: Stats; fmt: (v: number) => string }) {
  const rows: Array<[string, number]> = [
    ['Min', s.min],
    ['P25', s.p25],
    ['Median', s.med],
    ['Mean', s.mean],
    ['P75', s.p75],
    ['Max', s.max],
  ];
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>Middle 50%: {fmt(s.p25)} to {fmt(s.p75)} (IQR {fmt(s.p75 - s.p25)})</div>
      <dl className={styles.tipGrid}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const HOW = 'The box is the middle half of the items, the line is the median, the diamond the mean. Whiskers reach the 5th and 95th percentile; dots are items outside them. Hover or focus the box for all six numbers.';

const Key = () => (
  <p className={styles.key}>Box: middle 50%. Line: median. Diamond: mean. Whiskers: p5 to p95. Dots: outside the whiskers.</p>
);

interface PassRow {
  pass: number;
  p5: number;
  p25: number;
  med: number;
  mean: number;
  p75: number;
  p95: number;
}
const PASS_ROWS: PassRow[] = [
  { pass: 1, p5: 0.12, p25: 0.3, med: 0.45, mean: 0.46, p75: 0.6, p95: 0.78 },
  { pass: 2, p5: 0.46, p25: 0.6, med: 0.91, mean: 0.79, p75: 0.94, p95: 0.98 },
  { pass: 3, p5: 0.36, p25: 0.44, med: 0.57, mean: 0.55, p75: 0.64, p95: 0.78 },
  { pass: 4, p5: 0.34, p25: 0.5, med: 0.7, mean: 0.66, p75: 0.8, p95: 0.9 },
  { pass: 5, p5: 0.56, p25: 0.7, med: 0.79, mean: 0.77, p75: 0.94, p95: 0.98 },
  { pass: 6, p5: 0.3, p25: 0.62, med: 0.84, mean: 0.7, p75: 0.88, p95: 0.97 },
];

function Track({ r, band, series }: { r: PassRow; band?: number; series?: number }) {
  const pos = (v: number) => `${v * 100}%`;
  return (
    <span className={styles.track} data-band={band} data-series={series}>
      <span className={styles.tWhisker} style={style({ '--a': pos(r.p5), '--b': pos(r.p95) })} />
      <span className={styles.tBox} style={style({ '--a': pos(r.p25), '--b': pos(r.p75) })} />
      <span className={styles.tMedian} style={style({ '--a': pos(r.med) })} />
      <span className={styles.tMean} style={style({ '--a': pos(r.mean) })} />
    </span>
  );
}

function PassRows() {
  return (
    <Card as="section" aria-label="quality by pass" header={<div className={styles.cardHead}><span className={styles.cardTitle}>quality by pass</span><Tag kind="count">6 passes · 20 items each</Tag></div>}>
      <div className={styles.passRows} role="group" aria-label="quality distribution by pass">
        {PASS_ROWS.map((r) => (
          <div key={r.pass} className={styles.passRow}>
            <Tag kind="count">Pass {r.pass}</Tag>
            <Track r={r} band={bandOfMedian(r.med)} />
            <span className={styles.passMed}>{fmtPct(r.med)}</span>
          </div>
        ))}
        <div className={styles.passAxis} aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span key={t} style={style({ '--x': t })}>{fmtPct(t)}</span>
          ))}
        </div>
      </div>
      <Key />
    </Card>
  );
}

const STEPS: Array<[string, PassRow]> = [
  ['retrieve', { pass: 0, p5: 0.05, p25: 0.1, med: 0.16, mean: 0.18, p75: 0.24, p95: 0.4 }],
  ['rerank', { pass: 0, p5: 0.1, p25: 0.18, med: 0.25, mean: 0.28, p75: 0.34, p95: 0.58 }],
  ['generate', { pass: 0, p5: 0.3, p25: 0.42, med: 0.55, mean: 0.62, p75: 0.7, p95: 1 }],
];

function StepRows() {
  return (
    <Card as="section" aria-label="Step timings" header={<div className={styles.cardHead}><span className={styles.cardTitle}>Step timings</span><Tag kind="count">3 steps</Tag></div>}>
      <div className={styles.passRows} role="group" aria-label="Step timing distribution">
        {STEPS.map(([name, r]) => (
          <div key={name} className={styles.passRow} data-wide="">
            <span className={styles.stepName}>{name}</span>
            <Track r={r} series={1} />
            <span className={styles.passMed}>{fmtMs(r.med * 4000)}</span>
          </div>
        ))}
        <div className={styles.passAxis} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((t) => (
            <span key={t} style={style({ '--x': t / 4 })}>{t}s</span>
          ))}
        </div>
      </div>
      <Key />
    </Card>
  );
}

export function BoxColouredMock() {
  return (
    <div className={styles.boxGrid} data-r5="box-coloured">
      <ChartCard
        title="quality"
        help
        band={bandOfMedian(QUALITY.med)}
        meta={<Tag kind="count">217 scored</Tag>}
        intro={<ScoreValue value={QUALITY.mean} type="percentage" direction="maximize" variant="text" />}
      >
        <BoxGlyph s={QUALITY} domain={[0, 1]} fmt={fmtPct} tone={{ band: bandOfMedian(QUALITY.med) }} name="quality, 217 scored: minimum 8%, 25th percentile 52%, median 71%, mean 66%, 75th percentile 84%, maximum 100%; band 3 of 5." />
        <Tip s={QUALITY} fmt={fmtPct} />
      </ChartCard>
      <ChartCard
        title="completeness"
        help
        band={bandOfMedian(QUALITY_LOW.med)}
        meta={<Tag kind="count">217 scored</Tag>}
        intro={<ScoreValue value={QUALITY_LOW.mean} type="percentage" direction="maximize" variant="text" />}
      >
        <BoxGlyph s={QUALITY_LOW} domain={[0, 1]} fmt={fmtPct} tone={{ band: bandOfMedian(QUALITY_LOW.med) }} name="completeness, 217 scored: median 31%; band 1 of 5." />
      </ChartCard>
      <ChartCard
        title="Response time"
        help
        meta={<Tag kind="count">86 items</Tag>}
        intro={<span className={styles.hero}>3.3 s <span className={styles.heroSub}>mean</span></span>}
      >
        <BoxGlyph s={LATENCY_STATS} domain={[LATENCY_STATS.min, LATENCY_STATS.max]} fmt={fmtMs} tone={{ series: 1 }} tail name="Response time, 86 items: minimum 501ms, median 2.30s, mean 3.30s, maximum 11.80s." />
      </ChartCard>
      <ChartCard
        title="tokens_used"
        help
        meta={
          <>
            <span className={styles.total} title="Sum of all values across all items">
              Total <b>64.0K</b>
            </span>
            <Tag kind="count">86 items</Tag>
          </>
        }
        intro={<span className={styles.hero}>743.9</span>}
      >
        <BoxGlyph s={TOKENS} domain={[TOKENS.min, TOKENS.max]} fmt={fmtInt} tone={{ series: 1 }} name="tokens_used, 86 items: minimum 321, median 724, mean 743.9, maximum 1,193, total 64.0K." />
      </ChartCard>
      <div className={styles.rowsWide}>
        <PassRows />
        <StepRows />
      </div>
    </div>
  );
}

/* ───────────────────────────── R3: metric detail panel ───────────────────────────── */

type Variant = 'en' | 'ar' | 'table';

interface Prose {
  label: string;
  text: string;
  ar?: boolean;
}

const EN_PROSE: Prose[] = [
  {
    label: 'Reason',
    text: 'The answer identifies the correct policy (clause 4.2) and quotes the approval threshold, but it never mentions the exception for existing customers that the reference answer calls out. The tone is appropriate and the length is acceptable. Two of the three required steps are present; the escalation step is missing.',
  },
  { label: 'Detailed reasoning trace', text: 'Step 1 matched the question to clause 4.2. Step 2 compared the quoted threshold with the reference. Step 3 looked for the exception and did not find it.' },
];

const AR_PROSE: Prose[] = [
  { label: 'Reason', ar: true, text: 'الإجابة تغطي معظم النقاط المطلوبة وتستشهد بالسياسة الصحيحة، لكنها لا تذكر الاستثناء الخاص بالعملاء الحاليين.' },
  { label: 'Reasoning', ar: true, text: 'حللت السؤال أولاً ثم قارنت الإجابة بالمرجع. الإجابة تذكر الحد الأدنى للموافقة لكنها لا تذكر الاستثناء الخاص بالعملاء الحاليين، لذلك خُفضت الدرجة. يُنصح بمراجعة الحالة يدوياً قبل الاعتماد على النتيجة.' },
  { label: 'Step by step reasoning notes', ar: true, text: 'الخطوة الأولى: قراءة السؤال. الخطوة الثانية: مطابقة الإجابة مع المرجع. الخطوة الثالثة: البحث عن الاستثناء ولم يُعثر عليه.' },
];

const FACTS_EN: Array<[string, string, boolean]> = [
  ['Judge model', 'gpt-5', false],
  ['Confidence', '0.74', true],
  ['Latency ms', '2140', true],
  ['Temperature', '0.2', true],
  ['Self consistency check result', 'Three of three re-scored samples agree within 0.05', false],
  ['Flags', 'missing_exception, no_owner', true],
];

interface CritRow {
  criterion: string;
  weight: number;
  score: number;
  note: string;
}
const CRIT: CritRow[] = [
  { criterion: 'Cites the governing policy', weight: 0.3, score: 1, note: 'Clause 4.2 quoted' },
  { criterion: 'States the approval threshold', weight: 0.25, score: 1, note: 'SAR 50,000' },
  { criterion: 'Mentions the existing-customer exception', weight: 0.25, score: 0, note: 'Missing' },
  { criterion: 'Escalation step is present', weight: 0.2, score: 0.5, note: 'Mentioned without an owner' },
];
const CRIT_COLS: Column<CritRow>[] = [
  { id: 'criterion', header: 'Criterion', sort: 'criterion', accessor: (r) => r.criterion, flex: true, minWidth: 200, wrap: 3 },
  { id: 'weight', header: 'Weight', sort: 'weight', accessor: (r) => r.weight, width: 80, align: 'end', mono: true },
  { id: 'score', header: 'Score', sort: 'score', accessor: (r) => r.score, width: 80, align: 'end', mono: true },
  { id: 'note', header: 'Note', sort: 'note', accessor: (r) => r.note, minWidth: 200, wrap: 3 },
];

interface EvRow {
  doc: string;
  page: number;
  relevance: number;
  quote: string;
}
const EVID: EvRow[] = [
  { doc: 'policy-handbook.pdf', page: 12, relevance: 0.93, quote: 'Approvals above SAR 50,000 require a second reviewer.' },
  { doc: 'faq.md', page: 3, relevance: 0.61, quote: 'Existing customers follow the fast track.' },
  { doc: 'guide.pdf', page: 7, relevance: 0.48, quote: 'Escalate to the regional owner within two days.' },
];
const EV_COLS: Column<EvRow>[] = [
  { id: 'doc', header: 'Doc', sort: 'doc', accessor: (r) => r.doc, width: 170 },
  { id: 'page', header: 'Page', sort: 'page', accessor: (r) => r.page, width: 70, align: 'end', mono: true },
  { id: 'relevance', header: 'Relevance', sort: 'relevance', accessor: (r) => r.relevance, width: 100, align: 'end', mono: true },
  { id: 'quote', header: 'Quote', sort: 'quote', accessor: (r) => r.quote, flex: true, minWidth: 260, wrap: 3 },
];

interface ChkRow {
  name: string;
  passed: string;
  weight: number;
}
const CHK: ChkRow[] = [
  { name: 'السياسة', passed: 'true', weight: 0.5 },
  { name: 'الاستثناء', passed: 'false', weight: 0.5 },
];
const CHK_COLS: Column<ChkRow>[] = [
  { id: 'name', header: 'Name', sort: 'name', accessor: (r) => r.name, flex: true, minWidth: 140 },
  { id: 'passed', header: 'Passed', sort: 'passed', accessor: (r) => r.passed, width: 90 },
  { id: 'weight', header: 'Weight', sort: 'weight', accessor: (r) => r.weight, width: 80, align: 'end', mono: true },
];

function ProseBlock({ p, primary }: { p: Prose; primary?: boolean }) {
  return (
    <div className={styles.prose}>
      <div className={styles.eyebrow} title={p.label}>{p.label}</div>
      <p
        className={styles.proseText}
        data-primary={primary ? '' : undefined}
        {...(p.ar ? { dir: 'rtl', lang: 'ar' } : { dir: 'auto' })}
      >
        {p.text}
      </p>
    </div>
  );
}

function TableBlock<R extends object>({ title, count, columns, rows }: { title: string; count: string; columns: Column<R>[]; rows: R[] }) {
  return (
    <div className={styles.tableBlock}>
      <div className={styles.eyebrowRow}>
        <span className={styles.eyebrow}>{title}</span>
        <span className={styles.muted}>{count}</span>
      </div>
      <DataTable<R>
        aria-label={title}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(rows.indexOf(r))}
        density="compact"
        densityLocked
        columnMenu={false}
        zebra={false}
        variant="embedded"
        stickyHeader={false}
        responsive="scroll"
      />
    </div>
  );
}

function Collapsed({ keys }: { keys: Array<[string, string]> }) {
  return (
    <div className={styles.tree} role="group" aria-label="Nested details">
      {keys.map(([k, v]) => (
        <button key={k} type="button" className={styles.treeRow} aria-expanded="false">
          <Icon name="chevron-right" size={14} />
          <span className={styles.treeKey}>{k}</span>
          <span className={styles.treeType}>{v}</span>
        </button>
      ))}
    </div>
  );
}

export function MetricPanelMock({ variant }: { variant: Variant }) {
  const [open, setOpen] = useState(true);
  const ar = variant === 'ar';
  const table = variant === 'table';
  const metric = ar ? 'arabic_judge' : 'rubric_judge';
  const value = ar ? 0.215 : table ? 0.62 : 0.207;
  const prose = ar ? AR_PROSE : table ? EN_PROSE.slice(0, 1) : EN_PROSE;
  if (!open)
    return (
      <Button size="sm" variant="neutral" onPress={() => setOpen(true)}>
        Reopen {metric} details
      </Button>
    );
  return (
    <section className={styles.panel} aria-label={`${metric} details`} data-r5-panel={variant}>
      <header className={styles.pHead}>
        <span className={styles.pName}>{metric}</span>
        <span className={styles.pScore}>
          <ScoreValue value={value} type="percentage" direction="maximize" variant="text" digits={1} />
        </span>
        {table ? <Tag kind="count">Pass 3</Tag> : null}
        {table ? <Tag tone="warning" title="Edited by a reviewer: 0.48 to 0.62">edited</Tag> : null}
        <span className={styles.pActions}>
          <Button size="sm" variant="neutral" icon={<Icon name="edit" size={14} />} onPress={() => undefined}>
            Edit score
          </Button>
          <IconButton label={`Close ${metric} details`} icon="close" onPress={() => setOpen(false)} />
        </span>
      </header>
      <div className={styles.pBody}>
        {prose.map((p, i) => (
          <ProseBlock key={p.label} p={p} primary={i === 0} />
        ))}
        {!ar ? (
          <dl className={styles.facts} aria-label="Judge metadata">
            {FACTS_EN.slice(0, table ? 6 : 5).map(([k, v, mono]) => (
              <div key={k} className={styles.fact}>
                <dt title={k.toLowerCase().replace(/ /g, '_')}>{k}</dt>
                <dd data-mono={mono ? '' : undefined}>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <dl className={styles.facts} aria-label="Judge metadata">
            <div className={styles.fact}>
              <dt title="confidence">Confidence</dt>
              <dd data-mono="">0.77</dd>
            </div>
            <div className={styles.fact}>
              <dt title="judge_model">Judge model</dt>
              <dd>gpt-5</dd>
            </div>
            <div className={styles.fact}>
              <dt title="explanation">Explanation</dt>
              <dd dir="rtl" lang="ar">درجة جيدة مع نقص في الاستثناءات</dd>
            </div>
          </dl>
        )}
        {ar ? <TableBlock title="Checks" count="2 rows" columns={CHK_COLS} rows={CHK} /> : null}
        {table ? (
          <>
            <TableBlock title="Score table" count="4 rows" columns={CRIT_COLS} rows={CRIT} />
            <TableBlock title="Evidence" count="3 rows" columns={EV_COLS} rows={EVID} />
          </>
        ) : null}
        {!table && !ar ? <TableBlock title="Criteria" count="4 rows" columns={CRIT_COLS} rows={CRIT} /> : null}
        {!ar ? (
          <Collapsed
            keys={table ? [['breakdown', 'object · 2 keys'], ['flags', 'array · 2 items']] : [['breakdown', 'object · 2 keys']]}
          />
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────────── gallery wrapper ───────────────────────────── */

export function Round5Mocks({
  Section,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Section id="round5" title="Round 5 run-detail mocks (design contract)">
      <Case wide label="r5-bars-10 (R1: 11 score buckets and a boolean; every bar bottom on the axis)">
        <div className={styles.frame}><BarsMock10 /></div>
      </Case>
      <Case wide label="r5-bars-20 (R1: 20 columns, dense counts, thinned labels)">
        <div className={styles.frame}><BarsMock20 /></div>
      </Case>
      <Case wide label="r5-box-coloured (R2: score band, series 1, per-pass rows, step rows; no number row)">
        <div className={styles.frame}><BoxColouredMock /></div>
      </Case>
      <Case wide label="r5-metric-panel-en (R3: one pass, English)">
        <div className={styles.frame}><MetricPanelMock variant="en" /></div>
      </Case>
      <Case wide label="r5-metric-panel-ar (R3: Arabic reasoning, long keys)">
        <div className={styles.frame}><MetricPanelMock variant="ar" /></div>
      </Case>
      <Case wide label="r5-metric-panel-table (R3: table-shaped details, pass 3)">
        <div className={styles.frame}><MetricPanelMock variant="table" /></div>
      </Case>
    </Section>
  );
}
