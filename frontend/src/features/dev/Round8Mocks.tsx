/**
 * Round 8 compare mocks (design stage): static visual contract for docs/internal/ui-migration/redesign8/compare.md.
 * Composed page mocks first (the whole compare page inside the app shell, default state, real size), then the Sweep
 * page, then the component state sheets (the appendix). Nothing here reads the API: the data is the
 * `frontend/scripts/seed-compare.ts` scenario (4 aligned runs x 40 items; 4 more runs for the 8-run page).
 * Round8Mocks.module.css holds the proposed recipe, written so the implementer can lift it into the components.
 * Cases: r8-page-compare, r8-page-compare-8runs, r8-page-compare-expanded, r8-page-sweep, r8-sheet-*.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Badge, Button, Chip, Icon, Pagination, SearchField, SegmentedControl, Select, Slider, Tag, type IconName } from '@/ui';
import styles from './Round8Mocks.module.css';

const noop = () => undefined;

/* ───────────────────────────── fixtures ───────────────────────────── */

interface RunFx {
  name: string;
  model: string;
  completed: number;
  errors: number;
  /** quality / correct averages, the paired change vs the baseline, its noise band and the up/down counts. */
  correct: [number, number, number, number, number];
  quality: [number, number, number, number, number];
  latency: string;
  latencyDelta: string;
}

/** [value %, change pts, noise pts, improved, regressed]; the first four are the seeded numbers. */
const RUNS: RunFx[] = [
  { name: 'baseline-gpt-mini', model: 'gpt-5-mini', completed: 38, errors: 3, correct: [20, 0, 0, 0, 0], quality: [47, 0, 0, 0, 0], latency: '1.3s', latencyDelta: '' },
  { name: 'cand-a-sonnet', model: 'claude-sonnet-4', completed: 39, errors: 3, correct: [37.5, 17.5, 16, 9, 2], quality: [62.3, 15.3, 8.8, 30, 9], latency: '1.3s', latencyDelta: '-3%' },
  { name: 'cand-b-small', model: 'gpt-5-nano', completed: 37, errors: 3, correct: [5, -15, 13.6, 1, 7], quality: [36.2, -10.8, 8.2, 13, 26], latency: '1.3s', latencyDelta: '-3%' },
  { name: 'cand-c-same', model: 'gpt-5-mini', completed: 40, errors: 0, correct: [32.5, 12.5, 16.5, 8, 3], quality: [55, 8, 9, 25, 15], latency: '1.3s', latencyDelta: '-2%' },
  { name: 'cand-d-mini-high', model: 'gpt-5-mini', completed: 40, errors: 0, correct: [67.5, 47.5, 16.2, 19, 0], quality: [72.7, 25.7, 8, 36, 4], latency: '1.1s', latencyDelta: '-12%' },
  { name: 'cand-e-haiku', model: 'claude-haiku-4', completed: 39, errors: 1, correct: [20, 0, 16.2, 5, 5], quality: [43.7, -3.3, 8.9, 17, 23], latency: '1.2s', latencyDelta: '-8%' },
  { name: 'cand-f-large', model: 'gpt-5', completed: 40, errors: 0, correct: [70, 50, 17.7, 21, 1], quality: [80.7, 33.7, 7.8, 35, 5], latency: '1.3s', latencyDelta: '+3%' },
  { name: 'cand-g-flash', model: 'gemini-2.5-flash', completed: 40, errors: 0, correct: [30, 10, 17.4, 8, 4], quality: [56.6, 9.6, 9.8, 22, 18], latency: '1.1s', latencyDelta: '-14%' },
];

/** Task errors per run (the rest of `errors` are scorer errors). */
const TASK_ERR = [2, 1, 3, 0, 0, 1, 0, 0];

const colorOf = (i: number): CSSProperties => ({ ['--run' as string]: `var(--chart-${(i % 8) + 1})` });

/** Score band by value: the 5-step ramp (`--score-1..5`) at the design language's cut points. */
const band = (pct: number) => (pct < 40 ? 1 : pct < 60 ? 2 : pct < 75 ? 3 : pct < 90 ? 4 : 5);

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOMAINS = ['commerce', 'finance', 'support', 'analytics'];
const LEVELS = ['easy', 'medium', 'hard'];
/** The seeded scores of items 1 to 4 for runs A to D; later items are drawn from the run's skill. */
const SEEDED: number[][] = [
  [50.1, 81.2, 36.9, 67.7],
  [74.1, 66.9, 13.7, 30.1],
  [19.1, 51.5, 14.1, 31.4],
  [86, 82.9, 43.3, 99.7],
];
const ERRORS: Record<number, number[]> = { 5: [0, 2], 6: [2], 7: [1, 2], 9: [] };
const SKILL = [0, 0.15, -0.15, 0.01, 0.25, -0.05, 0.3, 0.06];

interface ItemFx {
  n: number;
  text: string;
  domain: string;
  level: string;
  scores: Array<number | 'error'>;
}

function makeItems(runCount: number): ItemFx[] {
  return Array.from({ length: 20 }, (_, k) => {
    const n = k + 1;
    const rnd = mulberry(n * 31 + 7);
    const scores = Array.from({ length: runCount }, (_, r) => {
      if (ERRORS[n]?.includes(r)) return 'error' as const;
      if (n <= 4 && r < 4) return SEEDED[k]![r]!;
      const v = (rnd() * 0.75 + 0.1 + SKILL[r]! * 0.7) * 100;
      return Math.max(2, Math.min(100, Math.round(v * 10) / 10));
    });
    return {
      n,
      text: `Question ${n}: what does clause ${k % 10} of the ${DOMAINS[k % 4]} policy require?`,
      domain: DOMAINS[k % 4]!,
      level: LEVELS[(k * 7) % 3]!,
      scores,
    };
  });
}

/* ───────────────────────────── shell (the real chrome, drawn at the real size) ───────────────────────────── */

const SIDE: Array<[IconName, string, boolean?]> = [
  ['folder', 'Projects'],
  ['book', 'Docs'],
  ['feedback', 'Feedback'],
];

function Shell({ children, crumb = 'Compare' }: { children: ReactNode; crumb?: string }) {
  return (
    <div className={styles.shell} data-testid="r8-shell">
      <aside className={styles.sidebar} aria-label="Navigation">
        <div className={styles.brand}>qym</div>
        <nav className={styles.sideNav}>
          {SIDE.map(([icon, label]) => (
            <span key={label} className={styles.navItem}>
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </span>
          ))}
          <p className={styles.navGroup}>Platform</p>
          <span className={styles.navItem}>
            <Icon name="shield" size={14} />
            <span>Admin</span>
          </span>
          <span className={styles.navItem}>
            <Icon name="trash" size={14} />
            <span>Deleted runs</span>
          </span>
        </nav>
        <div className={styles.user}>
          <span className={styles.avatar}>DU</span>
          <span className={styles.userText}>
            <strong>Dev User</strong>
            <span>dev@local</span>
          </span>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.topbar}>
          <Icon name="sidebar" size={14} />
          <span className={styles.crumbs}>
            Projects <Icon name="chevron-right" size={12} /> {crumb}
          </span>
        </div>
        <div className={styles.content} data-testid="r8-content">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── identity ───────────────────────────── */

/** A run is always its swatch and its name (the legacy rule): the name wraps, it is never cut. */
function RunName({ i, baseline, strong }: { i: number; baseline?: boolean; strong?: boolean }) {
  return (
    <span className={styles.runName} style={colorOf(i)} data-part="run-name" data-strong={strong ? '' : undefined}>
      <span className={styles.swatch} aria-hidden="true" />
      <span className={styles.runText}>
        {RUNS[i]!.name}
        {baseline ? <span className={styles.baselineTag}>Baseline</span> : null}
      </span>
    </span>
  );
}

function Head({ title, description, aside, id }: { title: string; description: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className={styles.head} id={id} data-part="section-head">
      <div className={styles.headText}>
        <h2 className={styles.h2}>{title}</h2>
        <p className={styles.desc}>{description}</p>
      </div>
      {aside ? <div className={styles.headAside}>{aside}</div> : null}
    </div>
  );
}

/* ───────────────────────────── page header, nav, notices ───────────────────────────── */

function PageTop({ runs, mode }: { runs: number; mode?: 'compare' | 'sweep' }) {
  return (
    <header className={styles.pageHeader} data-part="title-block">
      <div>
        <h1 className={styles.title}>Compare runs</h1>
        <p className={styles.subtitle}>
          Review configuration, performance and item-level differences across {runs} runs.
        </p>
        <p className={styles.meta}>
          <span>{runs} runs</span>
          <span aria-hidden="true">·</span>
          <span className={styles.mono}>cmp-qa-v1</span>
          <span aria-hidden="true">·</span>
          <span>40 aligned items</span>
        </p>
      </div>
      <div className={styles.headActions}>
        {mode ? (
          <SegmentedControl<'compare' | 'sweep'>
            label="Comparison view"
            value={mode}
            onChange={noop}
            options={[
              { value: 'compare', label: 'Compare' },
              { value: 'sweep', label: 'Sweep' },
            ]}
          />
        ) : null}
        <Button variant="accent" icon={<Icon name="download" size={14} />}>
          Export HTML
        </Button>
      </div>
    </header>
  );
}

const NAV_LINKS = ['Runs', 'Averages', 'Overview', 'Categories', 'Errors', 'Items'];

function SectionNav({ active = 'Runs' }: { active?: string }) {
  return (
    <nav className={styles.sectionNav} aria-label="Comparison sections" data-part="section-nav">
      {NAV_LINKS.map((l) => (
        <a key={l} className={styles.navLink} data-active={l === active ? '' : undefined} href={`#r8-${l}`}>
          {l}
          {l === 'Items' ? <span className={styles.navCount}>40</span> : null}
        </a>
      ))}
    </nav>
  );
}

/* ───────────────────────────── run cards ───────────────────────────── */

function RunCard({ i, removable = true }: { i: number; removable?: boolean }) {
  const r = RUNS[i]!;
  return (
    <article className={styles.runCard} style={colorOf(i)} data-part="run-card">
      <div className={styles.runCardTop}>
        <RunName i={i} baseline={i === 0} strong />
        <Badge tone="success" dot data-part="run-status">Completed</Badge>
        {removable ? (
          <button type="button" className={styles.removeBtn} aria-label={`Remove ${r.name} from the comparison`} data-part="run-remove">
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>
      <div className={styles.strip} data-part="run-stat-strip">
        <div className={styles.stripCell}>
          <span>Items</span>
          <b>40</b>
        </div>
        <div className={styles.stripCell}>
          <span>Completed</span>
          <b>{r.completed}</b>
        </div>
        <div className={styles.stripCell} data-bad={r.errors ? '' : undefined}>
          <span>Errors</span>
          <b>{r.errors}</b>
        </div>
      </div>
      <dl className={styles.facts} data-part="run-meta">
        {(
          [
            ['Task', 'qa_task'],
            ['Model', r.model],
            ['Owner', 'Dev User'],
            ['Dataset', 'cmp-qa-v1'],
            ['Started', 'Oct 1, 3:00 PM'],
            ['Runtime', '30m'],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={k === 'Owner' || k === 'Started' ? undefined : styles.mono}>{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function RunsSection({ count }: { count: number }) {
  return (
    <section className={styles.section} id="r8-Runs" data-part="section-runs">
      <Head title="Runs" description="Configuration and status of the compared runs. Remove a run with the cross; at least two stay." />
      <div className={styles.runGrid} data-part="run-grid">
        {RUNS.slice(0, count).map((_, i) => (
          <RunCard key={i} i={i} removable={count > 2} />
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── averages ───────────────────────────── */

function Value({ pct, boxed }: { pct: number; boxed?: 'up' | 'down' }) {
  return (
    <span className={styles.valueBox} data-band={band(pct)} data-verdict={boxed} data-part="averages-value">
      {pct.toFixed(1)}%
    </span>
  );
}

function AveragesSection({ count }: { count: number }) {
  const cols = RUNS.slice(0, count);
  const rows: Array<{ key: 'correct' | 'quality'; label: string }> = [
    { key: 'correct', label: 'correct' },
    { key: 'quality', label: 'quality' },
  ];
  return (
    <section className={styles.section} id="r8-Averages" data-part="section-averages">
      <Head
        title="Per-run averages"
        description="Each run against the baseline: the change, its 95% noise band, and how many items improved or regressed. Press a count to filter the items."
        aside={
          <>
            <div className={styles.inlineLabel}>
              <span aria-hidden="true">Baseline</span>
              <Select
                label="Baseline"
                hideLabel
                items={cols.map((r, i) => ({ key: String(i), label: r.name }))}
                value="0"
                onChange={noop}
                width="14rem"
              />
            </div>
          </>
        }
      />
      <div className={styles.avgScroll} data-part="averages-table">
        <div role="table" aria-label="Per-run averages" className={styles.avg} style={{ ['--cols' as string]: count }}>
          <div role="rowgroup" className={styles.thead}>
            <div role="row" className={styles.tr}>
              <div role="columnheader" className={styles.avgMetricHead}>
                Metric
              </div>
              {cols.map((_, i) => (
                <div role="columnheader" key={i} className={styles.avgRunHead} data-part="averages-colhead">
                  <RunName i={i} baseline={i === 0} />
                </div>
              ))}
            </div>
          </div>
          <div role="rowgroup" className={styles.tbody}>
            {rows.map((row) => (
              <div role="row" className={styles.tr} key={row.key} data-part="averages-metric-row">
                <div role="rowheader" className={styles.avgMetric}>
                  {row.label}
                </div>
                {cols.map((r, i) => {
                  const [v, d, n, up, down] = r[row.key];
                  const beyond = i > 0 && Math.abs(d) > n;
                  return (
                    <div role="cell" key={i} className={styles.avgCell} data-part="averages-cell" data-run={r.name}>
                      <Value pct={v} boxed={beyond ? (d > 0 ? 'up' : 'down') : undefined} />
                      {i === 0 ? null : (
                        <>
                          <span className={styles.delta} data-tone={!beyond ? 'flat' : d > 0 ? 'up' : 'down'} data-part="averages-delta">
                            {!beyond ? '≈' : d > 0 ? '▲' : '▼'} {d > 0 ? '+' : d < 0 ? '−' : ''}
                            {Math.abs(d).toFixed(1)} pts <i>±{n.toFixed(1)}</i>
                          </span>
                          <span className={styles.counts} data-part="averages-counts">
                            <button type="button" data-kind="up" aria-label={`${up} items improved`}>
                              ↑{up}
                            </button>
                            <button type="button" data-kind="down" aria-label={`${down} items regressed`}>
                              ↓{down}
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <div role="row" className={styles.tr} data-part="averages-latency-row">
              <div role="rowheader" className={styles.avgMetric}>
                <Icon name="clock" size={12} /> Avg latency
              </div>
              {cols.map((r, i) => (
                <div role="cell" key={i} className={styles.avgCell} data-compact="" data-run={r.name}>
                  <span className={styles.plainValue}>{r.latency}</span>
                  {i === 0 ? null : <span className={styles.delta} data-tone="flat">{r.latencyDelta}</span>}
                </div>
              ))}
            </div>
            <div role="row" className={styles.tr} data-part="averages-errors-row">
              <div role="rowheader" className={styles.avgMetric}>
                Errors
              </div>
              {cols.map((r, i) => (
                <div role="cell" key={i} className={styles.avgCell} data-compact="" data-run={r.name}>
                  <span className={styles.plainValue} data-bad={r.errors ? '' : undefined}>
                    {r.errors ? `${TASK_ERR[RUNS.indexOf(r)]} task · ${r.errors - TASK_ERR[RUNS.indexOf(r)]!} scorer` : 'none'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── overview ───────────────────────────── */

function Overview({ count }: { count: number }) {
  const [metric, setMetric] = useState<'correct' | 'quality'>('quality');
  const wins = count === 4 ? [5, 24, 0, 11] : [4, 1, 0, 1, 8, 0, 21, 0];
  const ties = count === 4 ? 0 : 5;
  const total = wins.reduce((a, b) => a + b, 0) + ties;
  const tiles: Array<[string, string, number | null]> = [
    [`Pass@${count}`, '47.5%', 47.5],
    [`Pass^${count}`, '0.0%', 0],
    [`Max@${count}`, '71.5%', 71.5],
    ['Consistency', '67.5%', 67.5],
    ['Reliability', '50.0%', 50],
    ['Avg score', '50.1%', 50.1],
    ['Avg latency', '1.3s', null],
    ['Errors', '9', null],
  ];
  const dist = count === 4 ? [21, 6, 7, 6, 0] : [8, 5, 7, 6, 4, 6, 4, 2, 0];
  const dTotal = dist.reduce((a, b) => a + b, 0);
  return (
    <section className={styles.section} id="r8-Overview" data-part="section-overview">
      <Head
        title="Comparison overview"
        description="Inspect the selected metric across runs, how many runs got each item right, and who won each item."
        aside={
          <>
            <Slider label="Pass if ≥" unit="%" minValue={5} maxValue={100} step={5} width="8rem" defaultValue={70} />
            <SegmentedControl<'correct' | 'quality'>
              label="Overview metric"
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'correct', label: 'correct' },
                { value: 'quality', label: 'quality' },
              ]}
            />
          </>
        }
      />
      <div className={styles.statGrid} data-part="stat-grid">
        {tiles.map(([label, value, pct]) => (
          <div key={label} className={styles.stat} data-part="stat-box">
            <span className={styles.statLabel}>{label}</span>
            <b className={styles.statValue} data-band={pct == null ? undefined : band(pct)} data-bad={label === 'Errors' ? '' : undefined}>
              {value}
            </b>
          </div>
        ))}
      </div>
      <div className={styles.block}>
        <h3 className={styles.h3}>Winner breakdown</h3>
        <div className={styles.winBar} data-part="winner-bar" role="group" aria-label="Winner breakdown">
          {wins.map((w, i) =>
            w ? (
              <button key={i} type="button" className={styles.winSeg} style={{ ...colorOf(i), flexGrow: w }} aria-label={`${RUNS[i]!.name} won ${w} items`}>
                <span>{w}</span>
              </button>
            ) : null,
          )}
          {ties ? (
            <button type="button" className={styles.winSeg} data-tie="" style={{ flexGrow: ties }} aria-label={`${ties} ties`}>
              <span>{ties}</span>
            </button>
          ) : null}
        </div>
        <ul className={styles.legend} data-part="winner-legend">
          {wins.map((w, i) => (
            <li key={i} style={colorOf(i)}>
              <span className={styles.swatch} aria-hidden="true" />
              {RUNS[i]!.name} <b>{w}</b>
            </li>
          ))}
          <li>
            Ties <b>{ties}</b>
          </li>
        </ul>
        <span hidden>{total}</span>
      </div>
      <div className={styles.block}>
        <h3 className={styles.h3}>Correct distribution</h3>
        <div className={styles.distBar} data-part="distribution-bar" role="group" aria-label="Runs correct per item">
          {dist.map((n, k) =>
            n ? (
              <button
                key={k}
                type="button"
                className={styles.distSeg}
                data-band={Math.min(5, 1 + Math.round((k / (dist.length - 1)) * 4))}
                style={{ flexGrow: n }}
                aria-label={`${k} of ${dist.length - 1} runs correct: ${n} items`}
              >
                <span>
                  {k}
                  <i>{n}</i>
                </span>
              </button>
            ) : null,
          )}
        </div>
        <p className={styles.axisNote}>
          Segment label: runs correct, then items. {dTotal} items in all.
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────────── categories ───────────────────────────── */

const CATS: Array<[string, string, string, number[]]> = [
  ['complexity', 'easy', '14', [65, 83, 52, 86, 91, 69, 95, 76]],
  ['complexity', 'medium', '13', [48, 64, 34, 52, 77, 39, 84, 58]],
  ['complexity', 'hard', '13', [26, 38, 21, 24, 48, 21, 62, 34]],
];

function Categories({ count }: { count: number }) {
  return (
    <section className={styles.section} id="r8-Categories" data-part="section-categories">
      <Head
        title="Performance by category"
        description="Average per metadata value and run, against the baseline tick. Press a card to filter the items."
        aside={
          <div className={styles.chipBar} data-part="category-chip-bar" role="group" aria-label="Metadata keys">
            <span className={styles.chipBarLabel}>Categories</span>
            <Chip isSelected count={3}>complexity</Chip>
            <Chip isSelected count={4}>domain</Chip>
          </div>
        }
      />
      <h3 className={styles.catKey}>
        <span aria-hidden="true">◆</span> complexity <Tag kind="data">quality</Tag>
      </h3>
      <div className={styles.catGrid} data-part="category-grid">
        {CATS.map(([, value, n, vals]) => (
          <button type="button" key={value} className={styles.catCard} data-level={value} data-part="category-card">
            <span className={styles.catTitle}>
              {value} <i>{n}</i>
            </span>
            <span className={styles.catCols} aria-hidden="true">
              <span>Run</span>
              <span>Average</span>
              <span>Latency</span>
              <span>Change</span>
            </span>
            <span className={styles.catRows}>
              {vals.slice(0, count).map((v, i) => {
                const d = Math.round((v - vals[0]!) * 10) / 10;
                return (
                  <span key={i} className={styles.catRow} style={colorOf(i)} data-part="category-run-row">
                    <span className={styles.catName}>
                      <span className={styles.swatch} aria-hidden="true" />
                      {RUNS[i]!.name}
                    </span>
                    <span className={styles.catNum} data-band={band(v)}>
                      {v}%
                    </span>
                    <span className={styles.catMuted}>1.{(i % 4) + 2}s</span>
                    <span className={styles.catChange} data-tone={i === 0 ? 'base' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}>
                      {i === 0 ? 'Baseline' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} pts`}
                    </span>
                    <span className={styles.track} data-part="category-track">
                      <span className={styles.fill} style={{ inlineSize: `${v}%` }} />
                      <span className={styles.tick} style={{ insetInlineStart: `${vals[0]}%` }} />
                    </span>
                  </span>
                );
              })}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── errors ───────────────────────────── */

function Errors({ count }: { count: number }) {
  const per = [2, 1, 3, 0, 0, 1, 0, 0];
  const metric = [1, 2, 0, 0, 0, 0, 0, 0];
  const card = (title: string, detail: string, nums: number[], kind: 'task' | 'metric') => (
    <div className={styles.errCard} data-kind={kind} data-part="error-card" role="button" tabIndex={0}>
      <div className={styles.errTop}>
        <b>{title}</b>
        <span className={styles.errCount}>
          {nums.slice(0, count).reduce((a, b) => a + b, 0)} <i>errors</i>
        </span>
      </div>
      <p className={styles.errDetail}>{detail}</p>
      <div role="table" aria-label="Errors per run" className={styles.errTable}>
        <div role="rowgroup" className={styles.tbody}>
          {nums.slice(0, count).map((n, i) => (
            <div role="row" className={styles.tr} key={i} data-part="error-run">
              <div role="cell">
                <RunName i={i} />
              </div>
              <div role="cell" className={styles.errN}>{n}</div>
              <div role="cell" className={styles.errD} data-tone={i === 0 ? 'base' : n - nums[0]! > 0 ? 'up' : n - nums[0]! < 0 ? 'down' : 'flat'}>
                {i === 0 ? 'Baseline' : n === nums[0] ? '=' : `${n - nums[0]! > 0 ? '+' : '−'}${Math.abs(n - nums[0]!)}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  return (
    <section className={styles.section} id="r8-Errors" data-part="section-errors">
      <Head title="Error distribution" description="Errors by kind and message for each run. Press a card to filter the items." />
      <div className={styles.errGroups}>
        <div data-part="error-group">
          <h3 className={styles.h3}>
            <Icon name="warning" size={12} /> Task errors <Tag kind="count">{per.slice(0, count).reduce((a, b) => a + b, 0)}</Tag>
          </h3>
          <div className={styles.errGrid}>{card('TimeoutError', 'task exceeded 30s', per, 'task')}</div>
        </div>
        <div data-part="error-group">
          <h3 className={styles.h3}>
            <Icon name="warning" size={12} /> Metric errors <Tag kind="count">{metric.slice(0, count).reduce((a, b) => a + b, 0)}</Tag>
          </h3>
          <div className={styles.errGrid}>{card('quality', 'JudgeError: malformed JSON', metric, 'metric')}</div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── items ───────────────────────────── */

function ScoreChip({ i, v }: { i: number; v: number | 'error' }) {
  return v === 'error' ? (
    <span className={styles.scoreChip} style={colorOf(i)} data-error="" title={`${RUNS[i]!.name}: task error`} data-part="item-score-chip">
      <span className={styles.swatch} aria-hidden="true" />
      <Icon name="close" size={12} />
      <span className={styles.srOnly}>task error</span>
    </span>
  ) : (
    <span className={styles.scoreChip} style={colorOf(i)} data-band={band(v)} title={`${RUNS[i]!.name}: ${v}%`} data-part="item-score-chip">
      <span className={styles.swatch} aria-hidden="true" />
      {v.toFixed(1)}%
    </span>
  );
}

function ItemRow({ item, open, children }: { item: ItemFx; open?: boolean; children?: ReactNode }) {
  const hasError = item.scores.includes('error');
  return (
    <li className={styles.itemRow} data-error={hasError ? '' : undefined} data-open={open ? '' : undefined} data-part="item-row">
      <div className={styles.itemHead} role="button" tabIndex={0} aria-expanded={!!open}>
        <span className={styles.chev} data-part="item-chevron">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </span>
        <span className={styles.itemNo} data-part="item-index">
          #{item.n}
        </span>
        <span className={styles.itemTitle} data-part="item-title">
          {item.text}
        </span>
        <span className={styles.chips} data-part="item-score-chips">
          {item.scores.map((v, i) => (
            <ScoreChip key={i} i={i} v={v} />
          ))}
        </span>
      </div>
      {children}
    </li>
  );
}

function Toolbar({ count, active }: { count: number; active?: boolean }) {
  return (
    <div className={styles.toolbar} data-part="items-toolbar">
      <div className={styles.query}>
        <SearchField label="Search items" hideLabel placeholder="Search inputs / outputs / expected..." width="100%" className={styles.search} />
        <Button icon={<Icon name="list" size={14} />} iconEnd={<Icon name="chevron-down" size={14} />} data-part="items-filters-btn">
          Filters <span className={styles.badgeCount} data-empty={active ? undefined : ''}>{active ? 1 : 0}</span>
        </Button>
        {active ? (
          <Button variant="danger" icon={<Icon name="close" size={12} />} data-part="items-clear-btn">
            Clear <span className={styles.badgeCount}>1</span>
          </Button>
        ) : null}
      </div>
      <div className={styles.actions}>
        <span className={styles.count} role="status" data-part="items-count">
          {active ? '26' : '40'} of 40 items
        </span>
        <Button icon={<Icon name="menu" size={14} />} iconEnd={<Icon name="chevron-down" size={14} />} data-part="items-display-btn">
          Display · quality
        </Button>
        <Button variant="accent" icon={<Icon name="download" size={14} />} data-part="items-csv-btn">
          CSV
        </Button>
      </div>
      <span hidden>{count}</span>
    </div>
  );
}

function RunKey({ count }: { count: number }) {
  return (
    <ul className={styles.runKey} data-part="run-key" aria-label="Run colours">
      {RUNS.slice(0, count).map((_, i) => (
        <li key={i}>
          <RunName i={i} baseline={i === 0} />
        </li>
      ))}
    </ul>
  );
}

function ExpandedBody({ count, details }: { count: number; details: boolean }) {
  const vals = [
    ['Not sure about clause 0.', 'False', '50.1%', 'Missing approval requirement'],
    ['Clause 0 requires written approval.', 'True', '81.2%', ''],
    ['Not sure about clause 0.', 'False', '36.9%', 'Missing approval requirement'],
    ['Not sure about clause 0.', 'False', '67.7%', 'Missing approval requirement'],
    ['Clause 0 requires written approval and a witness.', 'True', '90.1%', ''],
    ['Not sure about clause 0.', 'False', '42.0%', 'Missing approval requirement'],
    ['Clause 0 requires written approval.', 'True', '88.4%', ''],
    ['Clause 0: approval is needed.', 'True', '70.3%', ''],
  ];
  return (
    <div className={styles.detail} data-part="item-detail">
      <div className={styles.block2} data-kind="input">
        <div className={styles.blockHead}>
          <span>Input</span>
          <button type="button" className={styles.iconBtn} aria-label="Copy input">
            <Icon name="copy" size={14} />
          </button>
        </div>
        <p>Question 1: what does clause 0 of the commerce policy require?</p>
      </div>
      <div className={styles.block2} data-kind="expected">
        <div className={styles.blockHead}>
          <span>Expected output</span>
          <button type="button" className={styles.iconBtn} aria-label="Copy expected output">
            <Icon name="copy" size={14} />
          </button>
        </div>
        <p>Clause 0 requires written approval.</p>
      </div>
      <div className={styles.metaTags}>
        <Tag kind="data">easy</Tag>
        <Tag kind="data">commerce</Tag>
      </div>
      <div className={styles.outHead}>
        <span className={styles.outLabel}>Output</span>
        <div className={styles.toggles} role="group" aria-label="Runs shown" data-part="output-toggles">
          {RUNS.slice(0, count).map((_, i) => (
            <button key={i} type="button" className={styles.toggle} style={colorOf(i)} aria-pressed="true" data-part="output-toggle">
              <span className={styles.swatch} aria-hidden="true" />
              {RUNS[i]!.name}
            </button>
          ))}
        </div>
        <span className={styles.toggleAll}>
          <button type="button">All</button>
          <button type="button">Only differing</button>
        </span>
      </div>
      <div className={styles.outGrid} style={{ ['--n' as string]: count }} data-part="output-grid">
        {RUNS.slice(0, count).map((r, i) => {
          const v = vals[i]!;
          const pass = v[1] === 'True';
          return (
            <article key={i} className={styles.outCard} style={colorOf(i)} data-part="output-card" data-pass={pass ? '' : undefined}>
              <header className={styles.outCardHead}>
                <span className={styles.outName}>
                  <span className={styles.swatch} aria-hidden="true" />
                  {r.name}
                </span>
                <span className={styles.outFacts}>
                  <span className={styles.passTag} data-pass={pass ? '' : undefined}>
                    {pass ? 'Pass' : 'Fail'}
                  </span>
                  {pass && i === 1 ? <span className={styles.bestTag}>Best</span> : null}
                  <span className={styles.latency}>1.{4 + (i % 3)}s</span>
                  <Button size="sm" icon={<Icon name="list" size={12} />}>
                    Trace
                  </Button>
                  <button type="button" className={styles.iconBtn} aria-label="Copy output">
                    <Icon name="copy" size={14} />
                  </button>
                </span>
              </header>
              <p className={styles.outText}>{v[0]}</p>
              <div className={styles.metricRows}>
                {(
                  [
                    ['correct', v[1], pass ? 5 : 1],
                    ['quality', v[2], band(parseFloat(v[2]!))],
                  ] as const
                ).map(([m, val, b], k) => (
                  <button key={m} type="button" className={styles.metricRow} data-open={details && k === 0 ? '' : undefined} aria-expanded={details && k === 0}>
                    <Icon name={details && k === 0 ? 'chevron-down' : 'chevron-right'} size={12} />
                    <span className={styles.metricName}>{m}</span>
                    <span className={styles.metricVal} data-band={b}>
                      {val}
                    </span>
                    <Icon name="edit" size={12} />
                  </button>
                ))}
              </div>
              <div className={styles.reason} data-part="metric-details">
                {details ? (
                  v[3] ? (
                    <>
                      <b>Reason</b>
                      <span>{v[3]}</span>
                    </>
                  ) : (
                    <em>No details available.</em>
                  )
                ) : null}
              </div>
              <div className={styles.issues}>
                <b>Root-cause issues · {details ? 'correct' : 'quality'}</b>
                <span>No root-cause issues assigned.</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Items({ count, expanded, details }: { count: number; expanded?: boolean; details?: boolean }) {
  const items = makeItems(count);
  return (
    <section className={styles.section} id="r8-Items" data-part="section-items">
      <Head
        title="Item-by-item comparison"
        description="Filter and inspect aligned inputs, outputs, scores and review metadata."
        aside={
          <Button icon={<Icon name="sparkles" size={14} />} data-part="auto-analyze">
            Auto-analyze
          </Button>
        }
      />
      <Toolbar count={count} />
      <RunKey count={count} />
      <ul className={styles.itemList} data-part="item-list">
        {items.map((it) => (
          <ItemRow key={it.n} item={it} open={expanded && it.n === 1}>
            {expanded && it.n === 1 ? <ExpandedBody count={count} details={!!details} /> : null}
          </ItemRow>
        ))}
      </ul>
      <div className={styles.pager} data-part="pagination">
        <Pagination total={40} page={1} pageSize={20} noun="items" onPageChange={noop} />
      </div>
    </section>
  );
}

/* ───────────────────────────── composed compare page ───────────────────────────── */

function ComparePage({ count, expanded, details }: { count: number; expanded?: boolean; details?: boolean }) {
  return (
    <Shell>
      <div className={styles.page} data-testid="r8-compare-page" data-runs={count}>
        <PageTop runs={count} />
        <SectionNav active={expanded ? 'Items' : 'Runs'} />
        <RunsSection count={count} />
        <AveragesSection count={count} />
        <Overview count={count} />
        <Categories count={count} />
        <Errors count={count} />
        <Items count={count} expanded={expanded} details={details} />
      </div>
    </Shell>
  );
}

/* ───────────────────────────── Sweep ───────────────────────────── */

function Dots({ ok, of }: { ok: number; of: number }) {
  return (
    <span className={styles.passCell} data-part="sweep-pass-cell">
      <span className={styles.passTrack}>
        {Array.from({ length: of }, (_, k) => (
          <span key={k} className={styles.passDot} data-ok={k < ok ? '' : undefined} />
        ))}
      </span>
      <b>
        {ok}/{of}
      </b>
    </span>
  );
}

const SWEEP_STATS: Array<[string, string, string, string, string, 'bad' | 'flat']> = [
  ['Pass@2', '42.5%', '35.0%', '−7.5%', 'noise ±12.3', 'flat'],
  ['Avg@2', '54.7%', '45.6%', '−9.1%', 'noise ±6.8', 'bad'],
  ['Consistency', '72.5%', '67.5%', '−5.0%', 'noise ±14.8', 'flat'],
  ['Reliability', '67.6%', '53.6%', '−14.1%', 'no band', 'bad'],
  ['Pass^2', '15.0%', '2.5%', '−12.5%', 'noise ±12.3', 'bad'],
];

function SweepPage() {
  const rows: Array<[string, string, string, number, number, string]> = [
    ['cmp-007', 'support', 'easy', 0, 1, '+1'],
    ['cmp-034', 'finance', 'easy', 0, 1, '+1'],
    ['cmp-040', 'analytics', 'easy', 1, 2, '+1'],
    ['cmp-003', 'support', 'hard', 0, 0, '0'],
    ['cmp-005', 'commerce', 'medium', 0, 0, '0'],
    ['cmp-010', 'finance', 'easy', 1, 1, '0'],
    ['cmp-001', 'commerce', 'easy', 1, 0, '−1'],
    ['cmp-004', 'analytics', 'easy', 2, 1, '−1'],
    ['cmp-032', 'analytics', 'medium', 2, 0, '−2'],
  ];
  return (
    <Shell>
      <div className={styles.page} data-testid="r8-sweep-page">
        <PageTop runs={4} mode="sweep" />
        <div className={styles.sides} data-part="cohort-banner" role="group" aria-label="Compare sides">
          <span className={styles.sidesLabel}>Compare sides</span>
          <div className={styles.sidesRow}>
            <div className={styles.side}>
              <Tag kind="role">A / left</Tag>
              <b>baseline-gpt-mini</b>
              <span>2 runs</span>
            </div>
            <div className={styles.side}>
              <Tag kind="role">B / right</Tag>
              <b>cand-b-small</b>
              <span>2 runs</span>
            </div>
          </div>
        </div>
        <section className={styles.section} data-part="sweep">
          <Head
            title="Sweep"
            description="baseline-gpt-mini vs cand-b-small across 2 runs per cohort · metric: quality · 40/40 items shown"
            aside={<Button>Reverse</Button>}
          />
          <div className={styles.verdict} data-tone="bad" data-part="sweep-verdict">
            <Badge tone="danger">Regressed</Badge>
            <div>
              <b>Avg@2 −9.1% — beyond noise</b>
              <p>quality · noise ±6.8% at 95% · p = 0.009 · 40 paired items · declared primary metric, other metrics below are context</p>
            </div>
          </div>
          <div className={styles.sweepFilters} data-part="sweep-filters">
            {['Move', 'Outcome', 'Search', 'Metadata', 'Values'].map((l) => (
              <label key={l} className={styles.sweepField}>
                <span>{l}</span>
                <span className={styles.fakeSelect}>{l === 'Search' ? 'Item id, domain, complexity' : l === 'Move' ? 'All items' : l === 'Outcome' ? 'All outcomes' : l === 'Metadata' ? 'All categories' : 'No values'}</span>
              </label>
            ))}
          </div>
          <h3 className={styles.h3up}>Cohort metrics</h3>
          <div className={styles.sweepStats} data-part="sweep-stat-cards">
            {SWEEP_STATS.map(([label, from, to, delta, noise, tone]) => (
              <div key={label} className={styles.sweepStat} data-tone={tone}>
                <span className={styles.statLabel}>{label}</span>
                <span className={styles.sweepVals}>
                  <i>{from}</i> → <b>{to}</b>
                </span>
                <span className={styles.sweepDelta}>
                  <span data-tone={tone}>{delta}</span> {noise}
                </span>
              </div>
            ))}
          </div>
          <h3 className={styles.h3up}>Outcome summary</h3>
          <div className={styles.outcomes} data-part="sweep-outcome-cards">
            {(
              [
                ['40', 'Total items', ''],
                ['3', 'Improved', 'good'],
                ['10', 'Regressed', 'bad'],
                ['27', 'Unchanged', ''],
                ['0', 'Decisively fixed', 'good'],
                ['1', 'Decisively broken', 'bad'],
                ['0.00', 'Avg Δ attempts / item', ''],
              ] as const
            ).map(([v, l, t]) => (
              <div key={l} className={styles.outcome} data-tone={t || undefined}>
                <b>{v}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <div className={styles.sweepTableWrap} data-part="sweep-item-table">
            <div role="table" aria-label="Items" className={styles.sweepTable}>
              <div role="rowgroup" className={styles.thead}>
                <div role="row" className={styles.tr}>
                  <div role="columnheader">Item</div>
                  <div role="columnheader">Metadata</div>
                  <div role="columnheader">baseline-gpt-mini</div>
                  <div role="columnheader">cand-b-small</div>
                  <div role="columnheader">Move</div>
                </div>
              </div>
              <div role="rowgroup" className={styles.tbody}>
                {rows.map(([id, dom, lvl, l, r, mv]) => (
                  <div role="row" className={styles.tr} key={id} data-part="sweep-item-row">
                    <div role="rowheader">{id}</div>
                    <div role="cell">
                      <span className={styles.metaBadge} data-k="domain">◆ {dom}</span>
                      <span className={styles.metaBadge} data-k={lvl}>◆ {lvl}</span>
                    </div>
                    <div role="cell">
                      <Dots ok={l} of={2} />
                    </div>
                    <div role="cell">
                      <Dots ok={r} of={2} />
                    </div>
                    <div role="cell">
                      <span className={styles.move} data-tone={mv.startsWith('+') ? 'up' : mv.startsWith('−') ? 'down' : 'flat'}>
                        {mv}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

/* ───────────────────────────── appendix: component state sheets ───────────────────────────── */

function Sheet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.sheetRow}>
      <p className={styles.sheetLabel}>{label}</p>
      {children}
    </div>
  );
}

function StateSheets() {
  const items = makeItems(4);
  const items8 = makeItems(8);
  return (
    <div className={styles.sheet} data-testid="r8-sheets">
      <Sheet label="Run card: baseline, repeat run (3 passes), long name, error run">
        <div className={styles.runGrid} data-part="run-grid">
          <RunCard i={0} />
          <article className={styles.runCard} style={colorOf(1)} data-part="run-card">
            <div className={styles.runCardTop}>
              <span className={styles.runName} style={colorOf(1)}>
                <span className={styles.swatch} aria-hidden="true" />
                <span className={styles.runText}>customer-support-regression-after-prompt-rewrite-2026-10-24-nightly</span>
              </span>
              <Badge tone="success" dot>Completed</Badge>
              <button type="button" className={styles.removeBtn} aria-label="Remove run">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className={styles.strip}>
              {(['Items', 'Completed', 'Errors'] as const).map((k, n) => (
                <div key={k} className={styles.stripCell}>
                  <span>{k}</span>
                  <b>{[40, 40, 0][n]}</b>
                </div>
              ))}
            </div>
            <dl className={styles.facts}>
              {(
                [
                  ['Task', 'qa_task'],
                  ['Model', 'claude-sonnet-4'],
                  ['Owner', 'Dev User'],
                  ['Dataset', 'cmp-qa-v1'],
                  ['Started', 'Oct 1, 3:00 PM'],
                  ['Samples', '3 passes'],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className={styles.mono}>{v}</dd>
                </div>
              ))}
            </dl>
          </article>
          <article className={styles.runCard} style={colorOf(2)} data-part="run-card" data-failed="">
            <div className={styles.runCardTop}>
              <RunName i={2} strong />
              <Badge tone="danger" dot>Failed</Badge>
              <button type="button" className={styles.removeBtn} aria-label="Remove run">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className={styles.strip}>
              {(['Items', 'Completed', 'Errors'] as const).map((k, n) => (
                <div key={k} className={styles.stripCell} data-bad={n === 2 ? '' : undefined}>
                  <span>{k}</span>
                  <b>{[40, 12, 28][n]}</b>
                </div>
              ))}
            </div>
            <dl className={styles.facts}>
              {(
                [
                  ['Task', 'qa_task'],
                  ['Model', 'gpt-5-nano'],
                  ['Owner', 'Dev User'],
                  ['Dataset', 'cmp-qa-v1'],
                  ['Started', 'Oct 1, 3:00 PM'],
                  ['Runtime', '4m'],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className={styles.mono}>{v}</dd>
                </div>
              ))}
            </dl>
          </article>
        </div>
      </Sheet>
      <Sheet label="Item row: normal, task error (red outline), four chips at 1440; the same row with 8 runs">
        <ul className={styles.itemList}>
          <ItemRow item={items[0]!} />
          <ItemRow item={items[4]!} />
          <ItemRow item={items8[6]!} />
        </ul>
      </Sheet>
      <Sheet label="Count button pressed: the banner above the toolbar, Filters (1), Clear (1), '26 of 40 items'">
        <div className={styles.banner} data-part="baseline-delta-banner" role="status">
          <span>
            Showing items where <b>cand-b-small</b> regressed on <b>quality</b> against the baseline <b>baseline-gpt-mini</b>.
          </span>
          <Button>Clear</Button>
        </div>
        <Toolbar count={4} active />
      </Sheet>
      <Sheet label="Filters panel open (inline, under the toolbar; the page moves down, nothing is painted over)">
        <div className={styles.builder} data-part="filter-builder">
          <div className={styles.builderHead}>
            <b>Filters</b>
            <span>no rules yet</span>
          </div>
          <div className={styles.builderBody}>
            <SegmentedControl<'and' | 'or'>
              label="Match"
              value="and"
              onChange={noop}
              options={[
                { value: 'and', label: 'AND' },
                { value: 'or', label: 'OR' },
              ]}
            />
            <span className={styles.builderHint}>every rule below must match</span>
            <Button icon={<Icon name="plus" size={12} />}>Condition</Button>
            <Button icon={<Icon name="plus" size={12} />}>Group</Button>
          </div>
        </div>
      </Sheet>
      <Sheet label="Display popover (opens under its button, 300 px wide)">
        <div className={styles.popover} data-part="display-popover">
          <p className={styles.popSec}>Analysis metric</p>
          <div className={styles.popLine}>
            <span>Metric</span>
            <Select label="Metric" hideLabel items={[{ key: 'quality', label: 'quality' }, { key: 'correct', label: 'correct' }]} value="quality" onChange={noop} width="9rem" />
          </div>
          <p className={styles.popSec}>View</p>
          <div className={styles.popLine}>
            <span>Sort</span>
            <Select label="Sort" hideLabel items={[{ key: 'index', label: 'Index' }, { key: 'asc', label: 'Score ↑' }, { key: 'desc', label: 'Score ↓' }]} value="index" onChange={noop} width="9rem" />
          </div>
          <div className={styles.popLine}>
            <span>Text</span>
            <SegmentedControl<'raw' | 'rendered'>
              label="Text mode"
              value="raw"
              onChange={noop}
              options={[
                { value: 'raw', label: 'Raw' },
                { value: 'rendered', label: 'Rendered' },
              ]}
            />
          </div>
          <p className={styles.popSec}>Columns</p>
          <div className={styles.popLine}>
            <span>Item fields</span>
            <Select label="Item fields" hideLabel items={[{ key: 'all', label: 'All fields' }]} value="all" onChange={noop} width="9rem" />
          </div>
        </div>
      </Sheet>
      <Sheet label="Averages cell states: baseline, beyond noise up, beyond noise down, within noise">
        <div className={styles.cellRow}>
          {(
            [
              [0, 'base'],
              [1, 'up'],
              [2, 'down'],
              [3, 'flat'],
            ] as const
          ).map(([i, kind]) => {
            const [v, d, n, up, down] = RUNS[i]!.correct;
            return (
              <div key={kind} className={styles.avgCell} data-part="averages-cell">
                <Value pct={v} boxed={kind === 'up' ? 'up' : kind === 'down' ? 'down' : undefined} />
                {kind === 'base' ? (
                  <span className={styles.delta} data-tone="flat">
                    baseline
                  </span>
                ) : (
                  <>
                    <span className={styles.delta} data-tone={kind}>
                      {kind === 'flat' ? '≈' : d > 0 ? '▲' : '▼'} {d > 0 ? '+' : '−'}
                      {Math.abs(d).toFixed(1)} pts <i>±{n}</i>
                    </span>
                    <span className={styles.counts}>
                      <button type="button" data-kind="up">↑{up}</button>
                      <button type="button" data-kind="down">↓{down}</button>
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Sheet>
      <Sheet label="Loading frame (same layout as loaded), empty (fewer than 2 runs) and error (runs missing)">
        <div className={styles.states}>
          <div className={styles.skel} data-part="state-loading" aria-busy="true">
            <div className={styles.skelCards}>
              {[0, 1, 2, 3].map((k) => (
                <span key={k} className={styles.skelCard} />
              ))}
            </div>
            <span className={styles.skelTable} />
          </div>
          <div className={styles.stateBox} data-part="state-empty">
            <b>No runs to compare</b>
            <p>Select two or more runs on the Runs page and press Compare.</p>
            <Button variant="accent">Back to runs</Button>
          </div>
          <div className={styles.stateBox} data-part="state-error" data-tone="bad">
            <b>Runs in this comparison were not found</b>
            <p>2 of the runs in this link were deleted or are not visible to you. A comparison needs at least 2 runs.</p>
            <Button variant="accent">Back to runs</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/* ───────────────────────────── gallery wiring ───────────────────────────── */

export function Round8Mocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="round8" title="Round 8 compare mocks: the page component by component against the legacy page (design contract)">
      <Case wide label="r8-page-compare (the whole page in the app shell, 4 runs x 40 items, default state, real size)">
        <ComparePage count={4} />
      </Case>
      <Case wide label="r8-page-compare-expanded (item 1 open with the metric details row open under every run)">
        <ComparePage count={4} expanded details />
      </Case>
      <Case wide label="r8-page-compare-8runs (8 runs: the same components, nothing collapses)">
        <ComparePage count={8} />
      </Case>
      <Case wide label="r8-page-sweep (cohort mode: Compare | Sweep, compare sides, verdict, cohort metrics, outcome summary, item table)">
        <SweepPage />
      </Case>
      <Case wide label="r8-sheets (appendix: component states)">
        <StateSheets />
      </Case>
    </Sec>
  );
}
