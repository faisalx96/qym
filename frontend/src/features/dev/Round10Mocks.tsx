/**
 * Round 10 mocks (design stage): composed page mocks first, then the state sheets, for
 * docs/internal/ui-migration/redesign10/experiments.md. Primitives and tokens only; nothing reads the API.
 *
 * Composed pages (case ids r10-page-*, screenshot mock-page-<surface>-<1440|390>.png, /__mock/round10/<variant>):
 *   customize-where   Customize step 1 with the new bar (K1)
 *   customize-start   Customize step 2, the shortest step: the bar follows the content (K4)
 *   review            Review step, a 2-axis sweep (a linked pair + one plain axis) on 2 environments (K2, K3)
 *   env-versions      home view, production reports 5 keys incl. an object, staging 2 keys (K3)
 *   env-versions-none home view, production reports no key (K3)
 *   home-short        home view, one environment and no saved presets: the bar follows the content (K4)
 * State sheets (appendix): sheet-bar, sheet-versions, sheet-runs.
 * The CSS in Round10Mocks.module.css marked "recipe" is what moves into the components.
 */
import { Fragment, type ReactNode } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, Icon, PageHeader, Select, Tag, Text, type Column } from '@/ui';
import { StepPanel } from '@/features/experiments/launch/wizard/StepPanel';
import {
  DatasetsCard,
  healthy,
  KV,
  NameCard,
  PrioritySelect,
  Rail,
  Shell,
  StartFrom,
  TaskCard,
  type StepId,
} from './Round9Mocks';
import r9 from './Round9Mocks.module.css';
import styles from './Round10Mocks.module.css';

const noop = () => undefined;

/* ───────────────────────────── K1: the bar ───────────────────────────── */

interface StepsBarProps {
  step: StepId;
  runs?: number;
  problem?: string;
  /** Editor mode: the status counts changes and the review's primary publishes. */
  editor?: boolean;
  /** Review step: launch blocked (problems or the High acknowledgement). */
  blocked?: boolean;
}

/**
 * recipe (K1): far left Skip to review, Cancel; centre the status; far right Back, then the primary slot. The primary slot is
 * "Continue" on every step but the last and the launch (or publish) action on the review step; it has a fixed minimum width, so
 * Back never moves. No Launch button on any other step.
 */
export function StepsBar10({ step, runs = 2, problem, editor = false, blocked = false }: StepsBarProps) {
  const onReview = step === 'review';
  const primaryLabel = onReview ? (editor ? 'Publish v2' : `Launch ${runs} runs`) : 'Continue';
  return (
    <div className={styles.bar} role="region" aria-label="Launch" data-part="launch-bar" data-step={step}>
      <div className={styles.barStart}>
        <Button size="sm" variant="neutral" isDisabled={onReview} data-part="bar-skip" aria-label={editor ? 'Skip to review and publish' : 'Skip to review and launch'}>
          Skip<span className={styles.long}> to review</span>
        </Button>
        <Button size="sm" variant="ghost" data-part="bar-cancel">
          Cancel
        </Button>
      </div>
      <div className={styles.barStatus} data-part="bar-status" aria-live="polite">
        <span className={styles.barRuns}>{editor ? '3 changes vs v1' : runs === 1 ? '1 run to launch' : `${runs} runs to launch`}</span>
        {problem ? (
          <span className={styles.barProblem}>
            Fix 1 problem first<span className={styles.long}>: {problem}</span>
          </span>
        ) : (
          <span className={styles.barOk}>Ready</span>
        )}
      </div>
      <div className={styles.barEnd}>
        <Button size="sm" variant="neutral" data-part="bar-back" aria-label={step === 'where' ? 'Back to the start' : 'Back to the previous step'}>
          Back
        </Button>
        <Button
          size="sm"
          variant={onReview ? 'primary' : 'neutral'}
          className={styles.primary}
          isDisabled={onReview && (blocked || Boolean(problem))}
          data-part="bar-continue"
          data-action={onReview ? (editor ? 'publish' : 'launch') : 'continue'}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}

/** The home view's bar: unchanged content (K1), the K4 position (in flow after the content, sticky). */
function HomeBar10({ runs = 1, problem, name, base = 'Default preset v1', envs = 'production' }: { runs?: number; problem?: string; name?: string; base?: string; envs?: string }) {
  return (
    <div className={styles.bar} role="region" aria-label="Launch" data-part="launch-bar" data-bar="home">
      <div className={`${r9.nameInput} ${styles.barName}`} data-part="bar-name">
        {name ?? `${base} · ${envs} · 2026-11-03`}
      </div>
      <div className={styles.barStatus} data-part="bar-status">
        {problem ? (
          <>
            <span className={styles.barRuns}>1 problem to fix</span>
            <span className={`${styles.muted} ${styles.long}`}>{problem}</span>
          </>
        ) : (
          <span className={styles.barRuns}>
            Ready<span className={styles.long}>{`: ${base} on ${envs}`}</span>
          </span>
        )}
        <span className={styles.muted}>{runs === 1 ? '1 run to launch' : `${runs} runs to launch`}</span>
      </div>
      <div className={styles.barEnd}>
        <Button size="sm" variant="neutral" data-part="bar-customize">
          Customize →
        </Button>
        <Button size="sm" variant="primary" isDisabled={Boolean(problem)} data-part="bar-launch">
          Launch as is
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── K3: versions as the service reports them ───────────────────────────── */

type Details = Record<string, unknown>;

const V3: Details = { agent_version: 'agent-1.4.2', image_version: 'img-20261001', kb_version: 'kb-77' };
const V2: Details = { agent_version: 'agent-1.5.0', kb_version: 'kb-81' };
const V5: Details = {
  agent_version: 'agent-1.5.0',
  kb_version: 'kb-81',
  prompt_set: 'prompts-2026-11-01',
  model_routing: { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' },
  build: 4127,
};
const V1: Details = { release: '2026.11.0' };
const LONG: Details = {
  agent_version: 'agent-1.5.0',
  deployment_notes: 'canary rollout on eu-west-1 with the reranker v3 and the new prompt set',
  feature_flags: ['drafting', 'skills', 'viz-llm', 'router-hints', 'brief'],
  shadow_mode: false,
};

/** The source string of a value: strings as is, numbers and booleans as text, objects and arrays as compact JSON. */
function versionText(value: unknown): string {
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const MAX = 48;

/** recipe (K3): one value. Strings in a version Tag; numbers and booleans as mono text; objects as compact mono JSON, cut at 48 chars with the full text in the title. */
function VersionValue({ value }: { value: unknown }) {
  if (typeof value === 'string')
    return (
      <Tag kind="version" data-part="version-value">
        {value}
      </Tag>
    );
  const text = versionText(value);
  const cut = text.length > MAX;
  return (
    <span className={styles.vText} data-part="version-value" data-kind={typeof value === 'object' ? 'json' : 'scalar'} title={cut ? text : undefined}>
      {cut ? `${text.slice(0, MAX)}…` : text}
    </span>
  );
}

/** A key as the service names it, with a soft break after `_`, `-` and `.` (never truncated, DESIGN_LANGUAGE section 7). */
function KeyName({ name }: { name: string }) {
  const parts = name.split(/(?<=[_.-])/);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i ? <wbr /> : null}
          {p}
        </Fragment>
      ))}
    </>
  );
}

const PLACEHOLDERS = 3;
/** A value that does not fit one cell (more than 16 characters, or an object or array) takes the whole row. */
const WIDE = 16;
function isWide(value: unknown): boolean {
  return (value !== null && typeof value === 'object') || versionText(value).length > WIDE;
}

/**
 * recipe (K3): every key of versioning_details in the order the service returned it; at least three cells are laid out (the
 * missing ones are empty spacers), so 1 to 3 keys and the three-placeholder loading frame have one height.
 */
export function VersionsGrid({ details, loading = false }: { details?: Details; loading?: boolean }) {
  if (loading)
    return (
      <dl className={styles.vGrid} aria-busy="true">
        {Array.from({ length: PLACEHOLDERS }, (_, i) => (
          <div key={i} className={styles.vItem} aria-hidden="true">
            <dt>
              <span className={styles.skelKey}>&nbsp;</span>
            </dt>
            <dd>
              <span className={styles.skelValue} />
            </dd>
          </div>
        ))}
      </dl>
    );
  const keys = Object.keys(details ?? {});
  if (!keys.length) return <p className={styles.vEmpty}>No versioning details reported</p>;
  return (
    <dl className={styles.vGrid}>
      {keys.map((k) => (
        <div key={k} className={styles.vItem} data-wide={isWide(details![k]) ? '' : undefined}>
          <dt data-part="version-key">
            <KeyName name={k} />
          </dt>
          <dd>
            <VersionValue value={details![k]} />
          </dd>
        </div>
      ))}
      {Array.from({ length: Math.max(0, PLACEHOLDERS - keys.length) }, (_, i) => (
        // an empty cell with the loaded cell's DOM: it keeps the row a placeholder frame would take
        <div key={`s${i}`} className={`${styles.vItem} ${styles.vSpacer}`} aria-hidden="true">
          <dt>&nbsp;</dt>
          <dd>
            <span className={styles.skelValue} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

type VersionCase = { label: string; details?: Details; loading?: boolean; state?: 'unsupported' | 'error' };

/** The Versions line of an environment box. */
function EnvVersions10({ v }: { v: VersionCase }) {
  return (
    <div className={styles.versions} data-part="env-versions" data-case={v.label}>
      <span className={styles.versionsLabel}>Versions</span>
      {v.state === 'unsupported' ? (
        <p className={styles.vEmpty}>Not supported by this environment (its Evaluation Service is older than v1.2).</p>
      ) : v.state === 'error' ? (
        <p className={styles.vError}>Couldn’t read: kb offline</p>
      ) : (
        <VersionsGrid details={v.details} loading={v.loading} />
      )}
    </div>
  );
}

type BoxState = 'unselected' | 'selected';

function EnvBox10({ name, state, tags, versions }: { name: string; state: BoxState; tags: ReactNode; versions?: VersionCase }) {
  return (
    <li className={r9.box} data-part="env-box" data-state={state}>
      <span className={r9.boxHead}>
        <Checkbox isSelected={state === 'selected'} onChange={noop}>
          {name}
        </Checkbox>
      </span>
      <span className={styles.boxLinks}>
        {state === 'selected' ? <span className={r9.link}>Refresh</span> : null}
        <span className={r9.link}>Details</span>
      </span>
      <span className={r9.boxTags}>{tags}</span>
      {versions ? <EnvVersions10 v={versions} /> : null}
    </li>
  );
}

const stagingTags = (
  <>
    {healthy}
    <Tag kind="version">Default preset v1</Tag>
  </>
);

function EnvironmentsCard10({ production, staging }: { production?: VersionCase; staging?: VersionCase }) {
  return (
    <Card data-testid="env-section">
      <div className={r9.cardBody} data-part="env-section">
        <h3 className={r9.title}>Environments</h3>
        <ul className={r9.list}>
          <EnvBox10 name="production" state={production ? 'selected' : 'unselected'} tags={healthy} versions={production} />
          <EnvBox10 name="staging" state={staging ? 'selected' : 'unselected'} tags={stagingTags} versions={staging} />
        </ul>
        <p className={r9.help}>Pick several to run the same configuration on each. Settings are the union of their forms.</p>
        <div>
          <Button size="sm" variant="neutral" icon={<Icon name="plus" />}>
            New environment
          </Button>
        </div>
        <div className={r9.latency}>
          <Checkbox isSelected={false} onChange={noop}>
            Latency-sensitive run
          </Checkbox>
          <p className={r9.help}>
            Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign
            traffic overlaps. Expect a later start.
          </p>
        </div>
      </div>
    </Card>
  );
}

function DatasetPickCard() {
  return (
    <Card>
      <div className={r9.cardBody} data-part="dataset-section">
        <h3 className={r9.title}>Dataset</h3>
        <Select
          label="Dataset"
          hideLabel
          items={[
            { key: 'golden', label: 'golden' },
            { key: 'support-tickets', label: 'support-tickets' },
          ]}
          value="golden"
          onChange={noop}
        />
        <span className={r9.help}>golden · latest version · 7 items</span>
      </div>
    </Card>
  );
}

/** Start from for an environment without a default preset (the short-content home of K4). */
function StartFromNoPreset() {
  return (
    <Card>
      <div className={r9.cardBody}>
        <h3 className={r9.title}>Start from</h3>
        <div className={r9.startGrid}>
          <div className={r9.start} data-state="disabled">
            <span className={r9.startTitle}>Default preset</span>
            <span className={r9.startBody}>No default preset is published for production.</span>
          </div>
          <div className={r9.start}>
            <span className={r9.eyebrow}>Best past run</span>
            <span className={r9.startTitle}>Top-scoring run</span>
            <span className={r9.startBody}>The configuration of a top-scoring official run.</span>
          </div>
          <div className={r9.start}>
            <span className={r9.eyebrow}>Copy an experiment</span>
            <span className={r9.startTitle}>model x threshold x timeout</span>
            <span className={r9.startBody}>Your most recent experiment.</span>
          </div>
        </div>
        <span className={r9.label}>Other</span>
        <div className={styles.startOther}>
          <div className={r9.start} data-selected="">
            <span className={r9.startTitle}>From scratch</span>
            <span className={r9.startBody}>The environment’s own settings.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────────── pages ───────────────────────────── */

function HomeFrame({ children, bar }: { children: ReactNode; bar: ReactNode }) {
  return (
    <Shell crumbs={['Exp Demo', 'Experiments', 'New experiment']} className={styles.fill}>
      <PageHeader
        title="New experiment"
        description="Pick where it runs and what to start from. You can change anything in Customize."
        actions={
          <Button variant="ghost" size="sm">
            All experiments
          </Button>
        }
      />
      <div className={r9.page} data-testid="launch-home">
        {children}
        {bar}
      </div>
    </Shell>
  );
}

/** K4: one environment, no saved presets; the bar sits 14 px under the last card and is sticky only while the page overflows. */
function HomeShortPage() {
  return (
    <HomeFrame bar={<HomeBar10 runs={1} base="From scratch" />}>
      <TaskCard value="answer-ticket" offeredBy={['production']} />
      <div className={r9.where}>
        <EnvironmentsCard10 production={{ label: 'three', details: V3 }} />
        <DatasetPickCard />
      </div>
      <StartFromNoPreset />
    </HomeFrame>
  );
}

/** K3: production reports five keys (one an object), staging two (no image_version). */
function EnvVersionsPage() {
  return (
    <HomeFrame bar={<HomeBar10 runs={2} envs="production, staging" />}>
      <TaskCard value="answer-ticket" />
      <div className={r9.where}>
        <EnvironmentsCard10 production={{ label: 'five', details: V5 }} staging={{ label: 'two', details: V2 }} />
        <DatasetsCard />
      </div>
      <StartFrom />
    </HomeFrame>
  );
}

/** K3: production reports no key. */
function EnvVersionsNonePage() {
  return (
    <HomeFrame bar={<HomeBar10 runs={1} base="From scratch" />}>
      <TaskCard value="answer-ticket" offeredBy={['production']} />
      <div className={r9.where}>
        <EnvironmentsCard10 production={{ label: 'none', details: {} }} />
        <DatasetPickCard />
      </div>
      <StartFromNoPreset />
    </HomeFrame>
  );
}

function CustomizeFrame10({ step, children, runs = 2, problem, changes }: { step: StepId; children: ReactNode; runs?: number; problem?: string; changes?: Partial<Record<StepId, number>> }) {
  return (
    <Shell crumbs={['Exp Demo', 'Experiments', 'New experiment']} className={styles.fill}>
      <PageHeader
        title="Customize experiment"
        meta={['Exp Demo · Starting point: Clone of model x threshold x timeout']}
        actions={
          <>
            <Button variant="ghost" size="sm">
              ← Start
            </Button>
            <Button variant="ghost" size="sm">
              All experiments
            </Button>
          </>
        }
      />
      <div className={r9.page} data-part="customize">
        <Rail current={step} changes={changes} problems={problem ? { where: 1 } : undefined} />
        {children}
        <StepsBar10 step={step} runs={runs} problem={problem} />
      </div>
    </Shell>
  );
}

function WherePage10() {
  return (
    <CustomizeFrame10 step="where" runs={12} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="where" title="Where it runs" description="Name the experiment, set its priority and pick the task, the environments and the dataset.">
        <NameCard />
        <TaskCard />
        <div className={r9.where}>
          <EnvironmentsCard10 production={{ label: 'two', details: V2 }} staging={{ label: 'three', details: V3 }} />
          <DatasetPickCard />
        </div>
      </StepPanel>
    </CustomizeFrame10>
  );
}

function StartPage10() {
  return (
    <CustomizeFrame10 step="start" runs={12} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="start" title="Starting point" description="What the experiment starts from. Your changes are applied on top of it.">
        <StartFrom />
      </StepPanel>
    </CustomizeFrame10>
  );
}

/* ───────────────────────────── K2: swept settings as columns ───────────────────────────── */

interface Axis {
  /** The setting names (one per pointer; a linked axis has several). */
  names: string[];
  /** Section line under a name, only when the same name exists in two sections. */
  sections?: (string | undefined)[];
  /** values[step][member] */
  values: string[][];
  /** Which members are numbers or ids (mono). */
  mono: boolean[];
}

const AXES: Axis[] = [
  {
    names: ['Primary model', 'Milvus Search Threshold'],
    values: [
      ['gpt-4o prod', '0.5'],
      ['claude-sonnet eval', '0.7'],
    ],
    mono: [false, true],
  },
  { names: ['Timeout'], values: [['10'], ['30'], ['60']], mono: [true] },
];

const ENVS = ['staging', 'production'];

interface Run10 {
  n: number;
  env: string;
  /** one value per axis column, in column order */
  cells: string[];
}

/** The runs in dry-run order: combinations (last axis fastest), then environments. */
function expand(axes: Axis[], envs: string[]): Run10[] {
  const combos: string[][] = [[]];
  let out = combos;
  for (const axis of axes) {
    const next: string[][] = [];
    for (const c of out) for (const step of axis.values) next.push([...c, ...step]);
    out = next;
  }
  const runs: Run10[] = [];
  for (const c of out) for (const env of envs) runs.push({ n: runs.length + 1, env, cells: c });
  return runs;
}

interface AxisColumn {
  name: string;
  section?: string;
  mono: boolean;
  group?: string;
}

function axisColumns(axes: Axis[]): AxisColumn[] {
  const cols: AxisColumn[] = [];
  for (const axis of axes)
    axis.names.forEach((name, i) =>
      cols.push({ name, section: axis.sections?.[i], mono: axis.mono[i] ?? false, group: axis.names.length > 1 ? 'Linked: vary together' : undefined }),
    );
  return cols;
}

/** recipe (K2): one column per swept setting; a linked group shares a band; the header wraps, never truncates. */
function AxisHeader({ col }: { col: AxisColumn }) {
  return (
    <span className={styles.axisHead} data-part="axis-header">
      <span>{col.name}</span>
      {col.section ? <span className={styles.axisSection}>{col.section}</span> : null}
    </span>
  );
}

function RunsTable10({ axes = AXES, envs = ENVS, part = 'runs-table' }: { axes?: Axis[]; envs?: string[]; part?: string }) {
  const rows = expand(axes, envs);
  const cols = axisColumns(axes);
  const columns: Column<Run10>[] = [
    // no `label`: DataTable sizes a header's minimum from its label ("Run number" = 102 px), so the # column keeps 48 px
    { id: 'n', header: '#', width: 48, minWidth: 48, type: 'number', resizable: false, cell: (r) => r.n },
    ...(envs.length > 1 ? [{ id: 'env', header: 'Environment', minWidth: 120, flex: true, cell: (r: Run10) => r.env } as Column<Run10>] : []),
    ...cols.map(
      (c, i): Column<Run10> => ({
        id: `axis-${i}`,
        header: <AxisHeader col={c} />,
        label: c.section ? `${c.name} (${c.section})` : c.name,
        group: c.group,
        minWidth: 120,
        flex: true,
        mono: c.mono,
        cell: (r) => <span data-part="axis-cell">{r.cells[i]}</span>,
      }),
    ),
    {
      id: 'prio',
      header: 'Priority',
      width: 240,
      minWidth: 240,
      resizable: false,
      cell: (r) => (
        <span className={r9.prioCell}>
          <PrioritySelect run={r.n} value="NORMAL" />
        </span>
      ),
    },
  ];
  return (
    <div className={styles.runTable} data-part={part}>
      <DataTable<Run10>
        aria-label="Runs to launch"
        density="compact"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.n}
        stickyHeader={false}
        columnMenu={false}
        responsive="scroll"
        variant="embedded"
        rowProps={(r) => ({ 'data-run': String(r.n) })}
      />
    </div>
  );
}

function RunCards10({ axes = AXES, envs = ENVS, limit }: { axes?: Axis[]; envs?: string[]; limit?: number }) {
  const rows = expand(axes, envs).slice(0, limit);
  const cols = axisColumns(axes);
  return (
    <ul className={styles.runCards} data-part="runs-cards">
      {rows.map((r) => (
        <li key={r.n}>
          <dl className={r9.runCard}>
            <dt>Run</dt>
            <dd className={r9.mono}>{r.n}</dd>
            {envs.length > 1 ? (
              <>
                <dt>Environment</dt>
                <dd>{r.env}</dd>
              </>
            ) : null}
            {cols.map((c, i) => (
              <Fragment key={i}>
                <dt data-part="axis-header">{c.name}</dt>
                <dd className={c.mono ? r9.mono : undefined} data-part="axis-cell">
                  {r.cells[i]}
                </dd>
              </Fragment>
            ))}
            <dt>Priority</dt>
            <dd>
              <PrioritySelect run={r.n} value="NORMAL" />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** recipe (K2): the Summary's "Swept settings" row, one line per axis: name: v1, v2, v3 (a linked axis pairs its values). */
function SweptSettings({ axes = AXES }: { axes?: Axis[] }) {
  return (
    <ul className={styles.swept} data-part="review-swept">
      {axes.map((axis) => (
        <li key={axis.names.join('+')} className={styles.sweptLine} data-part="swept-axis">
          <span className={styles.sweptName}>{`${axis.names.join(' + ')}:`}</span>
          <span className={styles.sweptValues}>
            {axis.values.map((step, s) => (
              <span key={s} className={styles.sweptValue}>
                {step.map((v, m) => (
                  <Fragment key={m}>
                    {m ? <span className={styles.sweptJoin}> + </span> : null}
                    <span className={axis.mono[m] ? styles.monoValue : undefined}>{v}</span>
                  </Fragment>
                ))}
                {s < axis.values.length - 1 ? ',' : null}
              </span>
            ))}
            {axis.names.length > 1 ? (
              <Tag kind="count" tone="accent" title="Linked: the n-th values run together">
                linked
              </Tag>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReviewVersions() {
  return (
    <div className={styles.reviewVersions} data-part="review-versions">
      {[
        ['production', V2],
        ['staging', V3],
      ].map(([env, d]) => (
        <div key={env as string} className={styles.reviewEnv}>
          <span className={styles.reviewEnvName}>{env as string}</span>
          <VersionsGrid details={d as Details} />
        </div>
      ))}
    </div>
  );
}

function ReviewBody10() {
  const runs = expand(AXES, ENVS).length;
  return (
    <>
      <Card header={<Text variant="lg" weight={650}>Summary</Text>} data-testid="review-summary">
        <div data-part="review-summary">
          <KV
            rows={[
              ['Name', 'model x threshold x timeout (copy)'],
              ['Starts from', 'Clone of model x threshold x timeout'],
              ['Task', 'Answer ticket'],
              ['Environments', 'production, staging'],
              ['Dataset', 'golden', true],
              ['Swept settings', <SweptSettings key="s" />],
              ['Priority', 'Normal (the default of every run below)'],
              ['Versions', <ReviewVersions key="v" />],
            ]}
          />
        </div>
      </Card>
      <Card
        header={
          <div className={r9.sectionHead}>
            <h3 className={r9.sectionTitle}>
              <span className={r9.big} data-part="run-count">
                {runs}
              </span>{' '}
              runs to launch
            </h3>
            <span className={r9.runsTools}>
              <span className={r9.muted}>6 combinations × 2 environments = 12 runs</span>
              <span data-part="review-priority-all" className={r9.runsTools}>
                <span className={r9.label}>Set every run to</span>
                <PrioritySelect run={0} label="Set every run to" value="NORMAL" />
              </span>
            </span>
          </div>
        }
        flush
        data-testid="review-runs"
      >
        <div className={r9.cardBody} data-part="review-runs">
          <RunsTable10 />
          <RunCards10 />
        </div>
      </Card>
      <div className={r9.twoCol}>
        <Card header={<Text variant="lg" weight={650}>Changes from the starting point</Text>} data-testid="review-changes">
          <ul className={r9.changeList} data-part="review-changes">
            {['Models: 1 change', 'Environment configurations: 1 change', 'Sweeps: Primary model + Milvus Search Threshold (linked), Timeout'].map((t) => (
              <li key={t} className={r9.changeRow}>
                <span>{t}</span>
                <Button size="sm" variant="ghost">
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card header={<Text variant="lg" weight={650}>Checks</Text>} data-testid="review-checks">
          <div className={r9.cardBody} data-part="review-checks">
            <span className={r9.avail}>
              <Badge tone="success">Ready</Badge> 0 problems · task offered by both environments · schema checked
            </span>
          </div>
        </Card>
      </div>
      <div>
        <Button variant="neutral" size="sm">
          Show raw JSON
        </Button>
      </div>
    </>
  );
}

function ReviewPage10() {
  return (
    <CustomizeFrame10 step="review" runs={12} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="review" title="Review and launch" description="Check the summary and set a priority per run, then launch.">
        <ReviewBody10 />
      </StepPanel>
    </CustomizeFrame10>
  );
}

/* ───────────────────────────── appendix: state sheets ───────────────────────────── */

function Sheet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={r9.sheet}>
      <p className={r9.sheetLabel}>{label}</p>
      {children}
    </div>
  );
}

/** The bar in flow (the sheet stacks several; each is sticky only inside its own frame). */
function BarFrame({ children }: { children: ReactNode }) {
  return <div className={styles.barFrame}>{children}</div>;
}

function BarSheet10() {
  return (
    <div className={r9.sheet} data-part="bar-sheet">
      {(['where', 'start', 'models', 'settings', 'evaluation'] as StepId[]).map((s) => (
        <Sheet key={s} label={`Step: ${s} (Continue in the primary slot)`}>
          <BarFrame>
            <StepsBar10 step={s} runs={12} />
          </BarFrame>
        </Sheet>
      ))}
      <Sheet label="Step: review (Skip disabled in place; the primary slot launches)">
        <BarFrame>
          <StepsBar10 step="review" runs={12} />
        </BarFrame>
      </Sheet>
      <Sheet label="Step: review, blocked (the primary is disabled, the status names the first problem)">
        <BarFrame>
          <StepsBar10 step="review" runs={12} problem="Name" />
        </BarFrame>
      </Sheet>
      <Sheet label="A step with a problem (Continue stays enabled: moving on is never blocked)">
        <BarFrame>
          <StepsBar10 step="models" runs={12} problem="Name" />
        </BarFrame>
      </Sheet>
      <Sheet label="Editor, a middle step (Continue)">
        <BarFrame>
          <StepsBar10 step="models" editor />
        </BarFrame>
      </Sheet>
      <Sheet label="Editor, review and publish (the primary slot publishes)">
        <BarFrame>
          <StepsBar10 step="review" editor />
        </BarFrame>
      </Sheet>
      <Sheet label="Home view (unchanged content)">
        <BarFrame>
          <HomeBar10 runs={2} />
        </BarFrame>
      </Sheet>
    </div>
  );
}

const VERSION_CASES: VersionCase[] = [
  { label: 'loading', loading: true },
  { label: 'one', details: V1 },
  { label: 'two', details: V2 },
  { label: 'three', details: V3 },
  { label: 'five', details: V5 },
  { label: 'long', details: LONG },
  { label: 'none', details: {} },
  { label: 'unsupported', state: 'unsupported' },
  { label: 'error', state: 'error' },
];

/** Rows = what the service reports, columns = the environment box at its real width at 1440 (547 px), 1024 (339) and 390 (237). */
function VersionsSheet() {
  const widths = [
    ['1440', 547],
    ['1024', 339],
    ['390', 237],
  ] as const;
  return (
    <div className={styles.versionSheet} data-part="versions-sheet">
      {VERSION_CASES.map((v) => (
        <div key={v.label} className={styles.versionRow}>
          <p className={r9.sheetLabel}>{v.label}</p>
          <div className={styles.versionCols}>
            {widths.map(([w, px]) => (
              <ul key={w} className={r9.list} style={{ inlineSize: px }} data-width={w}>
                <EnvBox10 name="production" state="selected" tags={healthy} versions={v} />
              </ul>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const SIX: Axis[] = [
  { names: ['Primary model', 'Temperature'], values: [['gpt-4o prod', '0.2'], ['claude-sonnet eval', '0.7']], mono: [false, true] },
  { names: ['Timeout'], sections: ['Endpoints › primary'], values: [['10'], ['30']], mono: [true] },
  { names: ['Timeout'], sections: ['Endpoints › judge'], values: [['20'], ['60']], mono: [true] },
  { names: ['Milvus Search Threshold'], values: [['0.5']], mono: [true] },
  { names: ['Judge model'], values: [['temporary: gpt-4o-mini']], mono: [false] },
];
const SEVEN: Axis[] = [...SIX, { names: ['Context Max Tokens'], values: [['8000']], mono: [true] }];

function RunsSheet() {
  return (
    <div className={r9.sheet} data-part="runs-sheet">
      <Sheet label="One plain axis, one environment (Timeout 10, 30, 60)">
        <div className={styles.col1440}>
          <RunsTable10 axes={[AXES[1]!]} envs={['staging']} part="runs-table-one" />
        </div>
      </Sheet>
      <Sheet label="1440 column (1193 px): six axis columns fit (a linked pair, two Timeouts told apart by their section, a temporary model)">
        <div className={styles.col1440} data-width="1193">
          <RunsTable10 axes={SIX} envs={['staging', 'production']} part="runs-table-six" />
        </div>
      </Sheet>
      <Sheet label="1440 column: seven axis columns, the table scrolls sideways (the # column stays first)">
        <div className={styles.col1440} data-width="1193">
          <RunsTable10 axes={SEVEN} envs={['staging', 'production']} part="runs-table-seven" />
        </div>
      </Sheet>
      <Sheet label="1024 column (777 px): the round's sweep, three axis columns fit">
        <div className={styles.col1024} data-width="777">
          <RunsTable10 part="runs-table-1024" />
        </div>
      </Sheet>
      <Sheet label="1024 column: four axis columns scroll">
        <div className={styles.col1024} data-width="777">
          <RunsTable10 axes={[...AXES, { names: ['Context Max Tokens'], values: [['8000']], mono: [true] }]} part="runs-table-1024-four" />
        </div>
      </Sheet>
      <Sheet label="390: one card per run, one row per swept setting">
        <div className={styles.col390}>
          <RunCards10 limit={2} />
        </div>
      </Sheet>
      <Sheet label="Swept settings row (Summary) and the Changes line">
        <div className={styles.col1440}>
          <KV rows={[['Swept settings', <SweptSettings key="a" axes={SIX} />]]} />
        </div>
      </Sheet>
    </div>
  );
}

/* ───────────────────────────── the section ───────────────────────────── */

export function Round10Mocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="round10" title="Round 10: Customize bar, swept settings in the review, environment versions, the bar follows the content (composed pages first, then state sheets)">
      <Case wide label="r10-page-customize-where: Customize step 1, Skip and Cancel at the far left, Back and Continue at the far right">
        <WherePage10 />
      </Case>
      <Case wide label="r10-page-customize-start: the shortest step, the bar 14 px under the content">
        <StartPage10 />
      </Case>
      <Case wide label="r10-page-review: Review, a linked pair and a plain axis on two environments, one column per swept setting">
        <ReviewPage10 />
      </Case>
      <Case wide label="r10-page-env-versions: production reports five keys (one an object), staging two">
        <EnvVersionsPage />
      </Case>
      <Case wide label="r10-page-env-versions-none: production reports no key">
        <EnvVersionsNonePage />
      </Case>
      <Case wide label="r10-page-home-short: one environment, no saved presets, the bar follows the content">
        <HomeShortPage />
      </Case>
      <Case wide label="r10-sheet-bar: the bar on every step, blocked, editor, home">
        <BarSheet10 />
      </Case>
      <Case wide label="r10-sheet-versions: the Versions line for 0 to 5 keys, loading, long values, unsupported, error">
        <VersionsSheet />
      </Case>
      <Case wide label="r10-sheet-runs: axis columns at the real column widths, the scroll threshold, phone cards">
        <RunsSheet />
      </Case>
    </Sec>
  );
}

/** One composed page per variant, rendered alone at /__mock/round10/<variant> (used for the shots). */
export const ROUND10_PAGES: Record<string, { title: string; Page: () => JSX.Element }> = {
  'customize-where': { title: 'Customize step 1, new bar', Page: WherePage10 },
  'customize-start': { title: 'Customize step 2, short content', Page: StartPage10 },
  review: { title: 'Review, axis columns', Page: ReviewPage10 },
  'env-versions': { title: 'Environment versions, 5 and 2 keys', Page: EnvVersionsPage },
  'env-versions-none': { title: 'Environment versions, no key', Page: EnvVersionsNonePage },
  'home-short': { title: 'Home, short content', Page: HomeShortPage },
  'sheet-bar': { title: 'Bar states', Page: BarSheet10 },
  'sheet-versions': { title: 'Versions states', Page: VersionsSheet },
  'sheet-runs': { title: 'Runs table states', Page: RunsSheet },
};
