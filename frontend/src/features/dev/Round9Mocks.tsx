/**
 * Round 9 mocks (design stage): composed page mocks first, then the state sheets, for
 * docs/internal/ui-migration/redesign9/experiments.md. Primitives and tokens only; nothing reads the API.
 *
 * Composed pages (case ids r9-page-*, screenshot mock-page-<surface>-<1440|390>.png):
 *   r9-page-create-home, r9-page-customize-where, r9-page-customize-models, r9-page-customize-settings,
 *   r9-page-review, r9-page-preset-edit, r9-page-preset-publish, r9-page-environment, r9-page-environments-table.
 * State sheets (appendix, case ids r9-sheet-*): the bar on every step, environment boxes, the task section, the priority select,
 * table row states.
 * The shell is drawn at the real size (1440: sidebar 192, content column 1193; 390: 56 px rail, column 279).
 * The CSS in Round9Mocks.module.css marked "recipe" is what moves into the components.
 */
import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Icon,
  PageHeader,
  Select,
  Stepper,
  TabPanel,
  Tabs,
  Tag,
  Text,
  type Column,
  type IconName,
} from '@/ui';
import { StepPanel } from '@/features/experiments/launch/wizard/StepPanel';
import shell from './QaPageMocks.module.css';
import styles from './Round9Mocks.module.css';

const noop = () => undefined;

/* ───────────────────────────── shell ───────────────────────────── */

const NAV: [IconName, string, boolean?][] = [
  ['home', 'Dashboard'],
  ['chart', 'Charts'],
  ['list', 'Runs'],
  ['folder', 'Models'],
  ['flask', 'Experiments', true],
  ['sparkles', 'Auto-analysis'],
  ['review', 'Reviews'],
  ['database', 'Datasets'],
  ['settings', 'Project settings'],
];

export function Shell({
  crumbs,
  children,
  active = 'Experiments',
  className,
}: {
  crumbs: string[];
  children: ReactNode;
  active?: string;
  /** Round 10: a page that fills the viewport height (the bar-follows-content mocks). */
  className?: string;
}) {
  return (
    <div className={className ? `${shell.shell} ${className}` : shell.shell} data-testid="page-shell">
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
          <p className={shell.navGroup}>Exp Demo</p>
          {NAV.map(([icon, label]) => (
            <span key={label} className={shell.navItem} data-active={label === active ? '' : undefined}>
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
                {i > 0 ? <Icon name="chevron-right" size={12} /> : null}
                {c}
              </span>
            ))}
          </span>
        </div>
        <div className={shell.content}>{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────────────── fixtures ───────────────────────────── */

const TASKS: { key: string; label: string; description?: string }[] = [
  { key: 'worker', label: 'Worker default', description: 'Each service runs its own default task' },
  { key: 'answer-ticket', label: 'Answer ticket', description: 'production and staging' },
  { key: 'classify-intent', label: 'Classify intent', description: 'production and staging' },
  { key: 'summarize', label: 'Summarize thread', description: 'production only' },
];

const STEPS = [
  { id: 'where', label: 'Where it runs' },
  { id: 'start', label: 'Starting point' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Environment configurations' },
  { id: 'evaluation', label: 'Evaluation configurations' },
  { id: 'review', label: 'Review and launch' },
];

export type StepId = 'where' | 'start' | 'models' | 'settings' | 'evaluation' | 'review';

export function Rail({ current, changes, problems }: { current: StepId; changes?: Partial<Record<StepId, number>>; problems?: Partial<Record<StepId, number>> }) {
  return (
    <Stepper
      aria-label="Steps"
      current={current}
      onSelect={noop}
      steps={STEPS.map((s) => ({
        ...s,
        changes: changes?.[s.id as StepId],
        problems: problems?.[s.id as StepId],
      }))}
    />
  );
}

/* ───────────────────────────── the one bar (point 3) ───────────────────────────── */

interface BarProps {
  /** Which step the bar sits on; 'home' is the short path. */
  step: StepId | 'home';
  runs?: number;
  problem?: string;
  /** Review step: the primary action label. */
  launchLabel?: string;
  launchDisabled?: boolean;
  /** Editor mode: "Publish v2" instead of "Launch". */
  publish?: boolean;
  name?: string;
}

/**
 * The bar of every step (recipe). Slots, in order: Back | Skip to review | Continue | status | Cancel | Launch.
 * A slot that does not apply is disabled, never removed: Back goes to Start on step 1, Skip and Continue are disabled on the
 * Review step. On the home view the same chrome carries the name field, the status, Cancel is absent and the two actions are
 * "Launch as is" and "Customize".
 */
export function LaunchBar({ step, runs = 1, problem, launchLabel, launchDisabled, publish, name }: BarProps) {
  if (step === 'home') {
    return (
      <div className={styles.bar} role="region" aria-label="Launch" data-part="launch-bar" data-step="home">
        <div className={`${styles.nameInput} ${styles.barName}`} data-part="bar-name">
          {name || 'Experiment name'}
        </div>
        <div className={styles.barStatus} data-part="bar-status">
          <span className={styles.barRuns}>{runs === 1 ? '1 run to launch' : `${runs} runs to launch`}</span>
          {problem ? <span className={styles.barProblem}>{problem}</span> : <span className={styles.barOk}>Ready: Default preset v1 on staging</span>}
        </div>
        <div className={styles.barEnd}>
          <Button variant="neutral" data-part="bar-customize">Customize →</Button>
          <Button variant="primary" isDisabled={Boolean(problem)} data-part="bar-launch">
            Launch as is
          </Button>
        </div>
      </div>
    );
  }
  const onReview = step === 'review';
  return (
    <div className={styles.bar} role="region" aria-label="Launch" data-part="launch-bar" data-step={step}>
      <nav className={styles.barNav} aria-label="Step navigation">
        <Button size="sm" variant="neutral" data-part="bar-back">
          Back
        </Button>
        <Button size="sm" variant="neutral" isDisabled={onReview} data-part="bar-skip" aria-label="Skip to review">
          <span className={styles.barDesktopOnly}>Skip to review</span>
          <span className={styles.barPhoneOnly}>Skip</span>
        </Button>
        <Button size="sm" variant="accent" isDisabled={onReview} data-part="bar-continue">
          Continue
        </Button>
      </nav>
      <div className={styles.barStatus} data-part="bar-status" aria-live="polite">
        <span className={styles.barRuns}>{publish ? '3 changes vs v1' : runs === 1 ? '1 run to launch' : `${runs} runs to launch`}</span>
        {problem ? <span className={styles.barProblem}>{problem}</span> : <span className={styles.barOk}>Ready</span>}
      </div>
      <div className={styles.barEnd}>
        <Button size="sm" variant="ghost" data-part="bar-cancel">
          Cancel
        </Button>
        <Button size="sm" variant="primary" isDisabled={launchDisabled ?? Boolean(problem)} data-part="bar-launch">
          {launchLabel ?? (publish ? 'Publish v2' : runs === 1 ? 'Launch 1 run' : `Launch ${runs} runs`)}
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── boxes, cards (points 1, 2) ───────────────────────────── */

type BoxState = 'unselected' | 'selected' | 'flagged' | 'disabled';

function EnvBox({
  name,
  state,
  tags,
  versions,
  note,
}: {
  name: string;
  state: BoxState;
  tags: ReactNode;
  versions?: boolean;
  note?: string;
}) {
  return (
    <li className={styles.box} data-part="env-box" data-state={state}>
      <span className={styles.boxHead}>
        <Checkbox isSelected={state === 'selected' || state === 'flagged'} isDisabled={state === 'disabled'} onChange={noop}>
          {name}
        </Checkbox>
      </span>
      <span className={styles.link}>Details</span>
      <span className={styles.boxTags}>{tags}</span>
      {note ? (
        <p className={styles.boxNote} data-tone="danger" data-part="env-flag">
          {note}
        </p>
      ) : null}
      {versions ? (
        <span className={styles.boxLine} data-part="env-versions">
          <b>Versions</b>
          <span>agent</span>
          <Tag kind="version">agent-1.4.2</Tag>
          <span>image</span>
          <Tag kind="version">img-20261001</Tag>
          <span>kb</span>
          <Tag kind="version">kb-77</Tag>
        </span>
      ) : null}
    </li>
  );
}

export const healthy = (
  <>
    <Tag tone="success">Healthy</Tag>
    <Tag>Priority up to HIGH</Tag>
  </>
);

function EnvironmentsCard({ ticked = 'both', flagged = false }: { ticked?: 'none' | 'staging' | 'both'; flagged?: boolean }) {
  const prod: BoxState = ticked === 'both' ? (flagged ? 'flagged' : 'selected') : 'unselected';
  const stag: BoxState = ticked === 'none' ? 'unselected' : 'selected';
  return (
    <Card data-testid="env-section">
      <div className={styles.cardBody} data-part="env-section">
        <h3 className={styles.title}>Environments</h3>
        <ul className={styles.list}>
          <EnvBox
            name="production"
            state={prod}
            tags={healthy}
            versions={prod !== 'unselected'}
            note={flagged ? 'Does not offer the task “Classify intent”. Pick another task or untick this environment.' : undefined}
          />
          <EnvBox
            name="staging"
            state={stag}
            tags={
              <>
                {healthy}
                <Tag kind="version">Default preset v1</Tag>
              </>
            }
            versions={stag !== 'unselected'}
          />
        </ul>
        <p className={styles.help}>Pick several to run the same configuration on each. Settings are the union of their forms.</p>
        <div>
          <Button size="sm" variant="neutral" icon={<Icon name="plus" />}>
            New environment
          </Button>
        </div>
        <div className={styles.latency}>
          <Checkbox isSelected={false} onChange={noop}>
            Latency-sensitive run
          </Checkbox>
          <p className={styles.help}>
            Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign
            traffic overlaps. Expect a later start.
          </p>
        </div>
      </div>
    </Card>
  );
}

export function DatasetsCard() {
  return (
    <Card>
      <div className={styles.cardBody} data-part="dataset-section">
        <h3 className={styles.title}>Datasets</h3>
        <ul className={styles.list}>
          <li className={styles.box} data-part="dataset-box" data-state="unselected">
            <span className={styles.boxHead}>support-tickets</span>
            <Icon name="close" size={12} />
            <span className={styles.boxTags}>
              <Tag tone="accent">Versions · 2</Tag>
              <Tag kind="version">v2</Tag>
              <Tag kind="version">v3</Tag>
            </span>
          </li>
          <li className={styles.box} data-part="dataset-box" data-state="unselected">
            <span className={styles.boxHead}>billing-faq</span>
            <Icon name="close" size={12} />
            <span className={styles.boxTags}>
              <Tag tone="accent">Versions · 1</Tag>
              <Tag kind="version">Latest version</Tag>
            </span>
          </li>
        </ul>
        <div className={styles.sheetRow}>
          <Button size="sm" variant="neutral" icon={<Icon name="plus" />}>
            Add another dataset
          </Button>
          <span className={styles.help}>3 dataset versions · 2 runs each environment</span>
        </div>
      </div>
    </Card>
  );
}

/** The Task section (point 2): above the environments, one control, one availability line. */
export function TaskCard({
  value = 'answer-ticket',
  disabled = false,
  flagged = false,
  offeredBy = ['production', 'staging'],
}: {
  value?: string;
  disabled?: boolean;
  flagged?: boolean;
  /** Round 10: the ticked environments listed in the availability row. */
  offeredBy?: string[];
}) {
  const [v, setV] = useState<string>(disabled ? 'worker' : value);
  return (
    <Card data-testid="task-section">
      <div className={styles.cardBody} data-part="task-section">
        <div className={styles.cardTitleRow}>
          <h3 className={styles.title}>Task</h3>
          <span className={styles.help}>One task for the whole experiment</span>
        </div>
        <div className={styles.taskRow}>
          <div className={styles.taskSelect} data-part="task-select">
            <Select
              label="Task"
              hideLabel
              items={disabled ? [{ key: 'worker', label: 'Pick an environment first' }] : TASKS}
              value={v}
              onChange={(k) => k != null && setV(String(k))}
              isDisabled={disabled}
            />
          </div>
          {disabled ? null : (
            <span className={styles.avail} data-part="task-availability">
              <span className={styles.availLabel}>Offered by</span>
              {offeredBy.includes('production') ? <Tag tone="success">production</Tag> : null}
              {offeredBy.includes('staging') ? (
                flagged ? <Tag tone="danger">staging: not offered</Tag> : <Tag tone="success">staging</Tag>
              ) : null}
            </span>
          )}
        </div>
        <p className={styles.help}>
          The list is what the ticked environments offer. An environment that does not offer the chosen task is flagged and
          blocks the launch until the task or the environment changes.
        </p>
      </div>
    </Card>
  );
}

export function NameCard() {
  return (
    <Card aria-label="Name and priority">
      <div className={styles.cardBody}>
        <div className={styles.fieldRow}>
          <div className={styles.stack}>
            <span className={styles.label}>Experiment name</span>
            <div className={styles.nameInput}>Default preset v1 · production, staging · 2026-10-28</div>
          </div>
          <div className={styles.stack}>
            <span className={styles.label}>Priority</span>
            <Select
              label="Priority"
              hideLabel
              items={[
                { key: 'env', label: 'Environment default (NORMAL)' },
                { key: 'LOW', label: 'Low' },
                { key: 'NORMAL', label: 'Normal' },
                { key: 'HIGH', label: 'High' },
              ]}
              value="env"
              onChange={noop}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function StartFrom() {
  return (
    <Card>
      <div className={styles.cardBody}>
        <h3 className={styles.title}>Start from</h3>
        <div className={styles.startGrid}>
          <div className={styles.start} data-selected="">
            <span className={styles.eyebrow}>Recommended</span>
            <span className={styles.startTitle}>Default preset v1</span>
            <span className={styles.startBody}>What this environment’s managers published.</span>
          </div>
          <div className={styles.start}>
            <span className={styles.eyebrow}>Best past run</span>
            <span className={styles.startTitle}>Top-scoring run</span>
            <span className={styles.startBody}>The configuration of a top-scoring official run on support-tickets.</span>
          </div>
          <div className={styles.start}>
            <span className={styles.eyebrow}>Copy an experiment</span>
            <span className={styles.startTitle}>timeout sweep</span>
            <span className={styles.startBody}>Your most recent experiment.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────────── page 1: create home ───────────────────────────── */

function HomePage({ ticked = 'both' as 'none' | 'staging' | 'both', flagged = false, problem }: { ticked?: 'none' | 'staging' | 'both'; flagged?: boolean; problem?: string }) {
  return (
    <Shell crumbs={['Exp Demo', 'Experiments', 'New experiment']}>
      <PageHeader
        title="New experiment"
        description="Pick where it runs and what to start from. You can change anything in Customize."
        actions={
          <Button variant="ghost" size="sm">
            All experiments
          </Button>
        }
      />
      <div className={styles.page} data-testid="launch-home">
        <TaskCard disabled={ticked === 'none'} flagged={flagged} value={flagged ? 'classify-intent' : 'answer-ticket'} />
        <div className={styles.where}>
          <EnvironmentsCard ticked={ticked} flagged={flagged} />
          <DatasetsCard />
        </div>
        <StartFrom />
        <LaunchBar step="home" runs={2} problem={problem} />
      </div>
    </Shell>
  );
}

/* ───────────────────────────── pages 2: customize steps ───────────────────────────── */

function CustomizeFrame({ step, children, runs = 2, problem, changes }: { step: StepId; children: ReactNode; runs?: number; problem?: string; changes?: Partial<Record<StepId, number>> }) {
  return (
    <Shell crumbs={['Exp Demo', 'Experiments', 'New experiment']}>
      <PageHeader
        title="Customize experiment"
        meta={['Exp Demo · Starting point: Default preset v1']}
        actions={
          <>
            <Button variant="ghost" size="sm">← Start</Button>
            <Button variant="ghost" size="sm">All experiments</Button>
          </>
        }
      />
      <div className={styles.page} data-part="customize">
        <Rail current={step} changes={changes} problems={problem ? { where: 1 } : undefined} />
        {children}
        <LaunchBar step={step} runs={runs} problem={problem} />
      </div>
    </Shell>
  );
}

function WherePage() {
  return (
    <CustomizeFrame step="where" runs={2} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="where" title="Where it runs" description="Name the experiment, set its priority, choose the task, then pick the environments and datasets.">
        <NameCard />
        <TaskCard />
        <div className={styles.where}>
          <EnvironmentsCard />
          <DatasetsCard />
        </div>
      </StepPanel>
    </CustomizeFrame>
  );
}

function ModelsPage() {
  return (
    <CustomizeFrame step="models" runs={2} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="models" title="Models" description="Pick one model for every LLM endpoint, or a model per endpoint.">
        <Card>
          <div className={styles.cardBody}>
            <div className={styles.cardTitleRow}>
              <h3 className={styles.title}>Global model</h3>
              <Tag kind="count">1 of 1 endpoint</Tag>
            </div>
            <p className={styles.help}>Sets the model, base URL and API key of every endpoint at once.</p>
            <Select label="Global model" hideLabel items={[{ key: 'g', label: 'gpt-4o prod · gpt-4o' }]} value="g" onChange={noop} />
          </div>
        </Card>
        <div className={styles.endpoint}>
          <div className={styles.cardTitleRow}>
            <h3 className={styles.title}>Primary model</h3>
            <span className={styles.segment}>
              <Button size="sm" variant="accent">Follow global</Button>
              <Button size="sm" variant="neutral">Custom</Button>
            </span>
          </div>
          <p className={styles.help}>Uses the global model. Changing it updates this endpoint.</p>
        </div>
      </StepPanel>
    </CustomizeFrame>
  );
}

function SettingsPage() {
  return (
    <CustomizeFrame step="settings" runs={2} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="settings" title="Environment configurations" description="Overrides of the environment’s own settings, applied to every run of this experiment.">
        <div className={styles.tools}>
          <span className={styles.search}>Search settings</span>
          <Checkbox isSelected={false} onChange={noop}>
            Changed only
          </Checkbox>
          <Tag kind="count" tone="info">3 changed</Tag>
          <span style={{ marginInlineStart: 'auto' }}>
            <Button size="sm" variant="neutral">Reset all</Button>
          </span>
        </div>
        {['LLM routing', 'Feature toggles', 'Table selection / RAG', 'SQL runner', 'Context management', 'Visualization', 'Misc'].map((g) => (
          <div key={g} className={styles.group}>
            <Icon name="chevron-right" size={12} />
            {g}
          </div>
        ))}
      </StepPanel>
    </CustomizeFrame>
  );
}

/* ───────────────────────────── page 3: review (points 4, 5, 6) ───────────────────────────── */

type Prio = 'LOW' | 'NORMAL' | 'HIGH';
interface RunRow {
  n: number;
  env: string;
  dataset: string;
  sweep: string;
  prio: Prio;
  changed?: boolean;
}

const RUNS: RunRow[] = [
  { n: 1, env: 'production', dataset: 'support-tickets v3', sweep: 'timeout 10', prio: 'HIGH', changed: true },
  { n: 2, env: 'production', dataset: 'support-tickets v3', sweep: 'timeout 30', prio: 'NORMAL' },
  { n: 3, env: 'production', dataset: 'support-tickets v3', sweep: 'timeout 60', prio: 'NORMAL' },
  { n: 4, env: 'staging', dataset: 'support-tickets v3', sweep: 'timeout 10', prio: 'LOW', changed: true },
  { n: 5, env: 'staging', dataset: 'support-tickets v3', sweep: 'timeout 30', prio: 'NORMAL' },
  { n: 6, env: 'staging', dataset: 'support-tickets v3', sweep: 'timeout 60', prio: 'NORMAL' },
];

/** The priority select of one run (recipe): Low / Normal / High; High off for non-managers and above an environment's cap. */
export function PrioritySelect({
  run,
  label,
  value,
  canHigh = true,
  capped,
}: {
  run: number;
  label?: string;
  value: Prio;
  canHigh?: boolean;
  capped?: string;
}) {
  const [v, setV] = useState<Prio>(value);
  return (
    <span className={styles.prio} data-part="run-priority">
      <Select
        label={label ?? `Priority of run ${run}`}
        hideLabel
        items={[
          { key: 'LOW', label: 'Low' },
          { key: 'NORMAL', label: 'Normal' },
          {
            key: 'HIGH',
            label: 'High',
            description: !canHigh ? 'Only project managers' : capped ? `Capped at ${capped}` : 'Can preempt other work',
            disabled: !canHigh || Boolean(capped),
          },
        ]}
        value={v}
        onChange={(k) => k != null && setV(String(k) as Prio)}
      />
    </span>
  );
}

function RunsTable({ rows = RUNS }: { rows?: RunRow[] }) {
  const columns: Column<RunRow>[] = [
    { id: 'n', header: '#', width: 56, type: 'number', cell: (r) => <span className={styles.mono}>{r.n}</span>, priority: 1 },
    { id: 'env', header: 'Environment', width: 160, cell: (r) => r.env, priority: 1 },
    { id: 'dataset', header: 'Dataset', flex: true, minWidth: 200, cell: (r) => <span className={styles.mono}>{r.dataset}</span>, priority: 2 },
    { id: 'sweep', header: 'Swept setting', width: 200, cell: (r) => <Tag kind="data">{r.sweep}</Tag>, priority: 2 },
    { id: 'task', header: 'Task', width: 160, cell: () => 'Answer ticket', priority: 3 },
    {
      id: 'prio',
      header: 'Priority',
      width: 240,
      cell: (r) => (
        <span className={styles.prioCell}>
          <PrioritySelect run={r.n} value={r.prio} />
          {r.changed ? (
            <span className={styles.changed} data-part="run-changed">
              <span className={styles.dot} aria-hidden="true" /> changed
            </span>
          ) : null}
        </span>
      ),
      priority: 1,
    },
  ];
  return (
    <div className={styles.runTable} data-part="runs-table">
      <DataTable<RunRow> aria-label="Runs to launch" density="compact" columns={columns} rows={rows} rowKey={(r) => r.n} stickyHeader={false} variant="embedded" />
    </div>
  );
}
function RunCards({ rows = RUNS }: { rows?: RunRow[] }) {
  return (
    <ul className={styles.runCards} data-part="runs-cards">
      {rows.map((r) => (
        <li key={r.n}>
          <dl className={styles.runCard}>
            <dt>Run</dt>
            <dd className={styles.mono}>{r.n}</dd>
            <dt>Environment</dt>
            <dd>{r.env}</dd>
            <dt>Dataset</dt>
            <dd className={styles.mono}>{r.dataset}</dd>
            <dt>Swept</dt>
            <dd>
              <Tag kind="data">{r.sweep}</Tag>
            </dd>
            <dt>Priority</dt>
            <dd>
              <PrioritySelect run={r.n} value={r.prio} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function KV({ rows }: { rows: [string, ReactNode, boolean?][] }) {
  return (
    <dl className={styles.kv} data-part="review-kv">
      {rows.map(([k, v, mono]) => (
        <div key={k} className={styles.kvRow}>
          <dt>{k}</dt>
          <dd data-mono={mono ? '' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewBody({ publish = false }: { publish?: boolean }) {
  return (
    <>
      <Card header={<Text variant="lg" weight={650}>Summary</Text>} data-testid="review-summary">
        <div data-part="review-summary">
          {publish ? (
            <KV
              rows={[
                ['Environment', 'staging'],
                ['Task', 'Answer ticket'],
                ['Dataset', 'golden · latest', true],
                ['Compared with', 'Default preset v1'],
                ['Changes', <Tag key="c" kind="count" tone="info">3 changes vs v1</Tag>],
              ]}
            />
          ) : (
            <KV
              rows={[
                ['Name', 'Default preset v1 · production, staging · 2026-10-28'],
                ['Starts from', 'Default preset v1'],
                ['Task', 'Answer ticket'],
                ['Environments', 'production, staging'],
                ['Datasets', 'support-tickets v3 · billing-faq latest', true],
                ['Priority', 'Normal (the default of every run below)'],
                ['Versions', 'agent-1.4.2 · img-20261001 · kb-77', true],
              ]}
            />
          )}
        </div>
      </Card>
      {publish ? (
        <Card header={<Text variant="lg" weight={650}>Release notes</Text>}>
          <div className={styles.cardBody} data-part="release-notes">
            <p className={styles.help}>Required. What changed and why; shown in the version history.</p>
            <div className={styles.nameInput} style={{ minHeight: 'calc(var(--row-comfortable) * 2)', alignItems: 'flex-start', paddingBlock: 'var(--space-sm)' }}>
              What changed and why
            </div>
            <span className={styles.help}>0 / 5000</span>
          </div>
        </Card>
      ) : (
        <Card
          header={
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>
                <span className={styles.big} data-part="run-count">6</span> runs to launch
              </h3>
              <span className={styles.runsTools}>
                <span className={styles.muted}>3 timeout values × 2 environments = 6 runs. Priority default: Normal</span>
                <span data-part="review-priority-all" className={styles.runsTools}>
                  <span className={styles.label}>Set every run to</span>
                  <PrioritySelect run={0} label="Set every run to" value="NORMAL" />
                </span>
              </span>
            </div>
          }
          flush
          data-testid="review-runs"
        >
          <div className={styles.cardBody} data-part="review-runs">
            <div style={{ padding: 'var(--space-md) var(--space-lg) 0' }}>
              <div className={styles.callout} data-part="review-ack" role="note">
                <b>1 run is High.</b>
                <span>High runs can preempt other teams’ queued work on production. Capped at Normal on staging.</span>
                <Checkbox isSelected onChange={noop}>
                  I understand that High runs can preempt other work
                </Checkbox>
              </div>
            </div>
            <RunsTable />
            <RunCards />
          </div>
        </Card>
      )}
      <div className={styles.twoCol}>
        <Card header={<Text variant="lg" weight={650}>Changes from the starting point</Text>} data-testid="review-changes">
          <ul className={styles.changeList} data-part="review-changes">
            {(publish
              ? ['Models: 1 change', 'Environment configurations: 2 changes']
              : ['Models: 1 change', 'Environment configurations: 3 changes', 'Sweeps: 1 swept setting']
            ).map((t) => (
              <li key={t} className={styles.changeRow}>
                <span>{t}</span>
                <Button size="sm" variant="ghost">Edit</Button>
              </li>
            ))}
          </ul>
        </Card>
        <Card header={<Text variant="lg" weight={650}>Checks</Text>} data-testid="review-checks">
          <div className={styles.cardBody} data-part="review-checks">
            <span className={styles.avail}>
              <Badge tone="success">Ready</Badge> 0 problems · task offered by both environments · schema checked
            </span>
            {publish ? null : (
              <details>
                <summary className={styles.help}>Run names (6)</summary>
                <ol className={styles.help}>
                  <li>timeout sweep · production · timeout=10</li>
                  <li>timeout sweep · production · timeout=30</li>
                </ol>
              </details>
            )}
          </div>
        </Card>
      </div>
      <div>
        <Button variant="neutral" size="sm">Show raw JSON</Button>
      </div>
    </>
  );
}

function ReviewPage() {
  return (
    <CustomizeFrame step="review" runs={6} changes={{ models: 1, settings: 3 }}>
      <StepPanel stepId="review" title="Review and launch" description="Check the summary and set a priority per run, then launch.">
        <ReviewBody />
      </StepPanel>
    </CustomizeFrame>
  );
}

/* ───────────────────────────── pages 4: preset editor on the same UI ───────────────────────────── */

const EDITOR_STEPS = [
  { id: 'where', label: 'Environment and dataset' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Environment configurations' },
  { id: 'evaluation', label: 'Evaluation configurations' },
  { id: 'review', label: 'Review and publish' },
];

function EditorFrame({ step, children, changes }: { step: StepId; children: ReactNode; changes?: Partial<Record<StepId, number>> }) {
  return (
    <Shell crumbs={['Exp Demo', 'Experiments', 'Environments', 'staging', 'Default preset']}>
      <PageHeader
        title="Default preset · staging"
        meta={['Exp Demo · Compared with: Default preset v1']}
        actions={<Button variant="ghost" size="sm">← Back to the environment</Button>}
      />
      <div className={styles.page} data-part="customize" data-mode="editor">
        <Stepper aria-label="Steps" current={step} onSelect={noop} steps={EDITOR_STEPS.map((s) => ({ ...s, changes: changes?.[s.id as StepId] }))} />
        {children}
        <LaunchBar step={step} publish launchDisabled={step === 'review' ? true : false} runs={1} problem={undefined} />
      </div>
    </Shell>
  );
}

function PresetEditPage() {
  return (
    <EditorFrame step="where" changes={{ models: 1, settings: 2 }}>
      <StepPanel stepId="where" title="Environment and dataset" description="Choose the task and dataset this default preset evaluates, and see what it is compared with.">
        <Card>
          <div className={styles.cardBody} data-part="compared-with">
            <div className={styles.cardTitleRow}>
              <h3 className={styles.title}>Compared with</h3>
              <Button size="sm" variant="ghost">Undo all changes</Button>
            </div>
            <span className={styles.runsTools}>
              <b>Default preset v1</b>
              <Tag kind="count" tone="info">3 changes vs v1</Tag>
            </span>
            <details>
              <summary className={styles.help}>Release notes of Default preset v1</summary>
              <p className={styles.help}>Initial default</p>
            </details>
          </div>
        </Card>
        <TaskCard />
        <div className={styles.where}>
          <Card>
            <div className={styles.cardBody} data-part="env-section">
              <h3 className={styles.title}>Environment</h3>
              <ul className={styles.list}>
                <EnvBox name="staging" state="selected" tags={<>{healthy}<Tag kind="version">Default preset v1</Tag></>} versions />
              </ul>
              <p className={styles.help}>A preset belongs to one environment, so it is fixed here.</p>
            </div>
          </Card>
          <DatasetsCard />
        </div>
      </StepPanel>
    </EditorFrame>
  );
}

function PresetPublishPage() {
  return (
    <EditorFrame step="review" changes={{ models: 1, settings: 2 }}>
      <StepPanel stepId="review" title="Review and publish" description="Check the summary, write the release notes, then publish v2.">
        <ReviewBody publish />
      </StepPanel>
    </EditorFrame>
  );
}

/* ───────────────────────────── pages 5, 6: environment page and table ───────────────────────────── */

function EnvTabs() {
  return (
    <Tabs
      label="Experiments sections"
      selected="environments"
      onSelect={noop}
      items={[
        { id: 'experiments', label: 'Experiments' },
        { id: 'queue', label: 'Queue' },
        { id: 'environments', label: 'Environments' },
      ]}
    >
      <TabPanel id="environments">{null}</TabPanel>
    </Tabs>
  );
}

function EnvSection({ id, title, desc, action, children }: { id: string; title: string; desc?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card data-testid={`env-section-${id}`}>
      <div className={styles.cardBody} data-part={`env-section-${id}`}>
        <div className={styles.sectionHead}>
          <div className={styles.stack}>
            <h3 className={styles.sectionTitle}>{title}</h3>
            {desc ? <span className={styles.help}>{desc}</span> : null}
          </div>
          {action}
        </div>
        {children}
      </div>
    </Card>
  );
}

function EnvironmentPage({ from }: { from: 'experiments' | 'settings' }) {
  return (
    <Shell crumbs={from === 'settings' ? ['Exp Demo', 'Experiments', 'Environments', 'staging'] : ['Exp Demo', 'Experiments', 'Environments', 'staging']}>
      <PageHeader
        title="staging"
        description="http://127.0.0.1:9089/exp-demo"
        actions={<Button variant="neutral" size="sm" icon={<Icon name="prev" size={12} />}>All environments</Button>}
        tabs={<EnvTabs />}
      />
      <div className={styles.sections} data-part="env-page" data-from={from}>
        <EnvSection id="status" title="Status" action={<Button size="sm" variant="neutral">Test connection</Button>}>
          <dl className={styles.kv}>
            {[
              ['State', 'Active'],
              ['Health', 'Healthy · 2 min ago'],
              ['API key', '••••2345'],
              ['Default preset', 'v1'],
              ['Created', '10/28/2026, 5:20:07 PM'],
            ].map(([k, v]) => (
              <div key={k} className={styles.kvRow}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </EnvSection>
        <EnvSection id="schema" title="Schema" desc="The launch form is generated from the service’s env-overrides schema." action={<Button size="sm" variant="neutral">Refresh schema</Button>}>
          <span className={styles.help}>Hash 249987512336 · fetched 2 min ago · 40 settings</span>
        </EnvSection>
        <EnvSection id="tasks" title="Tasks" desc="What this service offers for an experiment’s task." action={<Button size="sm" variant="neutral">Refresh</Button>}>
          <span className={styles.runsTools}>
            <Tag>Answer ticket</Tag>
            <Tag>Classify intent</Tag>
            <span className={styles.help}>default: Answer ticket</span>
          </span>
        </EnvSection>
        <EnvSection id="groups" title="LLM model groups" desc="Each group is one LLM picked at launch, and the sets of keys its model fills." action={<Button size="sm" variant="neutral">Edit groups</Button>}>
          <div className={styles.endpoint}>
            <div className={styles.runsTools}>
              <b>Primary model</b>
              <Tag kind="data">endpoint:primary</Tag>
              <Tag tone="success">Confirmed</Tag>
              <Tag>Required</Tag>
            </div>
            <span className={styles.help}>Model · Base URL · API key · Transport: timeout, max_attempts, max_connections</span>
          </div>
        </EnvSection>
        <EnvSection id="preset" title="Default preset" desc="What launches start from. Versions never change once published." action={<Button size="sm" variant="neutral">Edit and publish</Button>}>
          <span className={styles.help}>v1 · Initial default · published by Dev User</span>
        </EnvSection>
        <div className={styles.envFoot} data-part="env-footer">
          <Button variant="danger" size="sm">Delete environment</Button>
          <Button variant="primary" size="sm">Save changes</Button>
        </div>
      </div>
    </Shell>
  );
}

interface EnvRow {
  id: string;
  name: string;
  url: string;
  health: string;
  schema: string;
  groups: string;
  preset: string;
  cap: string;
}

const ENV_ROWS: EnvRow[] = [
  { id: 'prod', name: 'production', url: 'http://127.0.0.1:9088/exp-demo', health: 'Healthy', schema: 'f6ee7b936efe', groups: 'Confirmed', preset: '—', cap: 'HIGH' },
  { id: 'stag', name: 'staging', url: 'http://127.0.0.1:9089/exp-demo', health: 'Healthy', schema: '249987512336', groups: 'Confirmed', preset: 'v1', cap: 'HIGH' },
  { id: 'dev', name: 'dev-sandbox', url: 'http://127.0.0.1:9090/exp-demo', health: 'Not checked', schema: 'None', groups: 'Needs grouping', preset: '—', cap: 'NORMAL' },
];

/** The environments table (recipe, point 9): the whole row opens; a chevron at the row end is visible at rest. */
export function EnvTable() {
  const columns: Column<EnvRow>[] = [
    {
      id: 'name',
      header: 'Environment',
      flex: true,
      minWidth: 180,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (r) => (
        <a className={styles.nameLink} href="#round9" onClick={(e) => e.preventDefault()}>
          {r.name}
        </a>
      ),
    },
    { id: 'url', header: 'URL', width: 260, minWidth: 140, priority: 3, cell: (r) => <span className={styles.mono}>{r.url}</span> },
    { id: 'health', header: 'Health', width: 110, priority: 1, cell: (r) => <Tag tone={r.health === 'Healthy' ? 'success' : undefined}>{r.health}</Tag> },
    { id: 'schema', header: 'Schema', width: 130, priority: 2, cell: (r) => <span className={styles.mono}>{r.schema}</span> },
    { id: 'groups', header: 'LLM groups', width: 140, priority: 3, cell: (r) => <Tag tone={r.groups === 'Confirmed' ? 'success' : 'warning'}>{r.groups}</Tag> },
    { id: 'preset', header: 'Default preset', width: 130, priority: 2, cell: (r) => (r.preset === '—' ? '—' : <Tag kind="version">{r.preset}</Tag>) },
    { id: 'cap', header: 'Priority cap', width: 110, priority: 3, cell: (r) => <Tag kind="data">{r.cap}</Tag> },
    {
      id: 'open',
      header: 'Open',
      hideLabel: true,
      width: 40,
      align: 'end',
      priority: 1,
      cell: () => (
        <span className={styles.chev} data-part="env-row-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={14} />
        </span>
      ),
    },
  ];
  return (
    <div data-part="env-table">
      <DataTable<EnvRow>
        aria-label="Environments"
        density="regular"
        columns={columns}
        rows={ENV_ROWS}
        rowKey={(r) => r.id}
        onRowOpen={noop}
        rowActions={() => [{ id: 'test', label: 'Test connection', onPress: noop }]}
        minWidth={980}
        stickyHeader={false}
      />
    </div>
  );
}

function EnvTablePage() {
  return (
    <Shell crumbs={['Exp Demo', 'Experiments', 'Environments']}>
      <PageHeader
        title="Environments"
        description="Register Evaluation Service deployments; experiments launch jobs on them."
        actions={<Button variant="primary" size="md">+ Add environment</Button>}
        tabs={<EnvTabs />}
      />
      <EnvTable />
    </Shell>
  );
}

/* ───────────────────────────── appendix: state sheets ───────────────────────────── */

function Sheet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.sheet}>
      <p className={styles.sheetLabel}>{label}</p>
      {children}
    </div>
  );
}

function BarSheet() {
  return (
    <div className={styles.sheet} data-part="bar-sheet">
      {(['where', 'start', 'models', 'settings', 'evaluation'] as StepId[]).map((s) => (
        <Sheet key={s} label={`Step: ${s}`}>
          <LaunchBar step={s} runs={2} />
        </Sheet>
      ))}
      <Sheet label="Step: review (Skip and Continue disabled, same slots)">
        <LaunchBar step="review" runs={6} />
      </Sheet>
      <Sheet label="With a problem (Launch disabled, the problem link names the first one)">
        <LaunchBar step="models" runs={2} problem="Fix 1 problem first: Name" />
      </Sheet>
      <Sheet label="Home view (same chrome, the name field and two actions)">
        <LaunchBar step="home" runs={2} />
      </Sheet>
      <Sheet label="Editor mode (Publish replaces Launch)">
        <LaunchBar step="models" publish runs={1} />
      </Sheet>
    </div>
  );
}

function BoxSheet() {
  const row = (label: string, state: BoxState, extra?: Partial<Parameters<typeof EnvBox>[0]>) => (
    <div className={styles.frame}>
      <p className={styles.sheetLabel}>{label}</p>
      <ul className={styles.list}>
        <EnvBox name="production" state={state} tags={healthy} {...extra} />
      </ul>
    </div>
  );
  return (
    <div className={styles.sheetRow} data-part="box-sheet">
      {row('Unselected', 'unselected')}
      {row('Selected (versions line)', 'selected', { versions: true })}
      {row('Flagged: task not offered', 'flagged', { versions: true, note: 'Does not offer the task “Classify intent”.' })}
      {row('Disabled', 'disabled')}
    </div>
  );
}

function TaskSheet() {
  return (
    <div className={styles.sheet} data-part="task-sheet">
      <Sheet label="No environment ticked: disabled, reads Pick an environment first">
        <TaskCard disabled />
      </Sheet>
      <Sheet label="Both environments offer the task">
        <TaskCard />
      </Sheet>
      <Sheet label="staging does not offer the chosen task: availability row and the environment box are flagged">
        <TaskCard flagged value="classify-intent" />
      </Sheet>
    </div>
  );
}

function PrioritySheet() {
  return (
    <div className={styles.sheetRow} data-part="priority-sheet">
      <Sheet label="Default (inherits the experiment's Normal)">
        <PrioritySelect run={1} value="NORMAL" />
      </Sheet>
      <Sheet label="Changed to High (manager, production allows High)">
        <PrioritySelect run={2} value="HIGH" />
      </Sheet>
      <Sheet label="Not a manager: High disabled, reason in the option">
        <PrioritySelect run={3} value="NORMAL" canHigh={false} />
      </Sheet>
      <Sheet label="Environment cap Normal: High disabled">
        <PrioritySelect run={4} value="NORMAL" capped="NORMAL on staging" />
      </Sheet>
      <Sheet label="Acknowledgement needed (a run is High)">
        <div className={styles.callout} data-tone="danger" role="alert" style={{ maxInlineSize: 520 }}>
          <b>Acknowledge the preemption to launch</b>
          <span>1 run is High and can preempt other teams’ queued work.</span>
          <Checkbox isSelected={false} onChange={noop}>
            I understand that High runs can preempt other work
          </Checkbox>
        </div>
      </Sheet>
    </div>
  );
}

function TableStateSheet() {
  return (
    <div className={styles.sheet} data-part="table-sheet">
      <Sheet label="Rest, hover, focus are shown live on the table below: hover a row (fill --bg-hover, pointer cursor, name underlined, chevron darkens), Tab to a row (2px accent ring), Enter opens it">
        <EnvTable />
      </Sheet>
    </div>
  );
}

/* ───────────────────────────── the section ───────────────────────────── */

export function Round9Mocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="round9" title="Round 9: experiment creation, Customize bar, Review, preset editor, environment pages and tables (composed pages first, then state sheets)">
      <Case wide label="r9-page-create-home: New experiment home, Task section above the environments, boxes lighter than their card, one bar">
        <HomePage />
      </Case>
      <Case wide label="r9-page-create-home-flagged: home with a task one environment does not offer (flagged box, bar problem)">
        <HomePage flagged problem="Fix 1 problem first: staging does not offer Classify intent" />
      </Case>
      <Case wide label="r9-page-customize-where: Customize step 1, the same bar">
        <WherePage />
      </Case>
      <Case wide label="r9-page-customize-models: Customize step 3, the same bar, no review card">
        <ModelsPage />
      </Case>
      <Case wide label="r9-page-customize-settings: Customize step 4, the same bar, the review is not shown here">
        <SettingsPage />
      </Case>
      <Case wide label="r9-page-review: Review and launch, 6 runs with a priority select per run">
        <ReviewPage />
      </Case>
      <Case wide label="r9-page-preset-edit: Edit default preset in the Customize UI (step 1)">
        <PresetEditPage />
      </Case>
      <Case wide label="r9-page-preset-publish: Edit default preset, Review and publish">
        <PresetPublishPage />
      </Case>
      <Case wide label="r9-page-environment-experiments: the environment page opened from Experiments, Environments">
        <EnvironmentPage from="experiments" />
      </Case>
      <Case wide label="r9-page-environment-settings: the same page opened from Project settings, Environments (one route)">
        <EnvironmentPage from="settings" />
      </Case>
      <Case wide label="r9-page-environments-table: environments table, whole row opens, chevron at rest">
        <EnvTablePage />
      </Case>
      <Case wide label="r9-sheet-bar: the bar on every step, with a problem, home, editor">
        <BarSheet />
      </Case>
      <Case wide label="r9-sheet-boxes: environment box states">
        <BoxSheet />
      </Case>
      <Case wide label="r9-sheet-task: Task section states">
        <TaskSheet />
      </Case>
      <Case wide label="r9-sheet-priority: priority select states">
        <PrioritySheet />
      </Case>
      <Case wide label="r9-sheet-table: environments table row states">
        <TableStateSheet />
      </Case>
    </Sec>
  );
}

/** One composed page per variant, rendered alone at /__mock/round9/<variant> (light: no gallery around it; used for the shots). */
export const ROUND9_PAGES: Record<string, { title: string; Page: () => JSX.Element }> = {
  'create-home': { title: 'New experiment home', Page: () => <HomePage /> },
  'create-home-flagged': { title: 'Home with a flagged environment', Page: () => <HomePage flagged problem="Fix 1 problem first: staging does not offer Classify intent" /> },
  'customize-where': { title: 'Customize step 1', Page: WherePage },
  'customize-models': { title: 'Customize step 3', Page: ModelsPage },
  'customize-settings': { title: 'Customize step 4', Page: SettingsPage },
  review: { title: 'Review and launch', Page: ReviewPage },
  'preset-edit': { title: 'Edit default preset, step 1', Page: PresetEditPage },
  'preset-publish': { title: 'Edit default preset, review and publish', Page: PresetPublishPage },
  'environment-experiments': { title: 'Environment page from Experiments', Page: () => <EnvironmentPage from="experiments" /> },
  'environment-settings': { title: 'Environment page from Project settings', Page: () => <EnvironmentPage from="settings" /> },
  'environments-table': { title: 'Environments table', Page: EnvTablePage },
  'sheet-bar': { title: 'Bar states', Page: BarSheet },
  'sheet-boxes': { title: 'Environment box states', Page: BoxSheet },
  'sheet-task': { title: 'Task section states', Page: TaskSheet },
  'sheet-priority': { title: 'Priority select states', Page: PrioritySheet },
  'sheet-table': { title: 'Table row states', Page: TableStateSheet },
};
