/**
 * Multi-dataset / task launch mocks (WP-D design stage): static visual contracts for
 * docs/internal/feature-rounds/2026-10-multi-dataset-task/spec-d.md. Gallery anchor `/__ui#multi-launch`.
 * Real primitives, tokens and the real entry / review / launch CSS modules; nothing here reads the API.
 * The CSS in MultiLaunchMocks.module.css marked "recipe" is what the implementer moves into the components.
 *
 * Composed pages first (the whole page in the app shell, default state, realistic data, real size):
 *   md-page-home    the launch home view: 2 datasets x 2 versions, run shape, a task chosen for one environment, one older service
 *   md-page-step1   Customize step 1 "Where it runs" with the review pane (1440) / below the step (1024, 390)
 *   md-page-review  Review and launch: the review pane and Raw JSON
 *   md-page-detail  the experiment detail with a combined job and fanned-out jobs grouped by dataset version
 * then the state sheets (appendix): md-s-single, md-s-picker, md-s-shape, md-s-task, md-s-env, md-s-problems, md-s-raw.
 */
import type { ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Icon,
  IconButton,
  KeyValueGrid,
  MultiSelect,
  PageHeader,
  SectionHeader,
  SegmentedControl,
  Select,
  StatStrip,
  Stepper,
  Tag,
  Text,
  TextField,
  type Column,
  type IconName,
} from '@/ui';
import { Callout } from '@/features/experiments/launch/components/Callout';
import panel from '@/features/experiments/launch/components/launch.module.css';
import entry from '@/features/experiments/launch/entry/entry.module.css';
import review from '@/features/experiments/launch/review/review.module.css';
import { JobStatusBadge } from '@/features/experiments/components/StatusBadges';
import detail from '@/features/experiments/detail/detail.module.css';
import styles from './MultiLaunchMocks.module.css';

const noop = () => undefined;

/* ───────────────────────────── data ───────────────────────────── */

export interface DsEntry {
  name: string;
  chip?: string;
  /** Selected references: `Latest version`, `v3`, `alias production`. */
  refs: string[];
  /** Every reference the dataset offers (the popover list). */
  offer: string[];
}

const SUPPORT: DsEntry = {
  name: 'support-tickets',
  refs: ['v3', 'v4'],
  offer: ['Latest version', 'v4', 'v3', 'v2', 'v1', 'alias production'],
};
const BILLING: DsEntry = {
  name: 'billing-faq',
  chip: 'Restricted',
  refs: ['v1', 'v2'],
  offer: ['Latest version', 'v2', 'v1', 'alias production'],
};
const FOUR: DsEntry[] = [SUPPORT, BILLING];

interface TaskOption {
  id: string;
  name: string;
  description: string | null;
}
const TASKS: TaskOption[] = [
  { id: 'answer-ticket', name: 'Answer a ticket', description: 'Reply to a support ticket using the KB.' },
  { id: 'summarise-thread', name: 'Summarise a thread', description: null },
  { id: 'route-ticket', name: 'Route a ticket', description: 'Pick the queue a ticket belongs to.' },
];

const pairCount = (entries: DsEntry[]) => entries.reduce((n, e) => n + e.refs.length, 0);

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

function Shell({ crumbs, children }: { crumbs: string[]; children: ReactNode }) {
  return (
    <div className={styles.shell} data-testid="page-shell">
      <aside className={styles.sidebar} aria-label="Navigation">
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
          <p className={styles.navGroup}>Support agent</p>
          {NAV.map(([icon, label, active]) => (
            <span key={label} className={styles.navItem} data-active={active ? '' : undefined}>
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </span>
          ))}
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
            Support agent
            {crumbs.map((c) => (
              <span key={c} className={styles.crumbs}>
                <Icon name="chevron-right" size={12} /> {c}
              </span>
            ))}
          </span>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────────────── environment box ───────────────────────────── */

export type VersionState = 'ok' | 'loading' | 'unsupported' | 'error';
export type TaskState =
  | { kind: 'ok'; value: string }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; reason: string }
  | { kind: 'readonly'; value: string };

export interface ShapeNote {
  /** What this environment receives. */
  text: string;
  tone?: 'info' | 'warning';
}

function VersionLine({ state, env }: { state: VersionState; env: string }) {
  const values: [string, string][] = [
    ['agent', 'agent-1.4.2'],
    ['image', 'img-20261001'],
    ['kb', 'kb-77'],
  ];
  return (
    <div className={entry.versionLine} data-env-version={env} data-status={state}>
      <span className={entry.versionLabel}>Versions</span>
      {state === 'loading' ? (
        <>
          <span className={entry.srOnly} role="status">
            Reading…
          </span>
          <dl className={entry.versionList} aria-busy="true">
            {values.map(([k]) => (
              <div key={k} className={entry.versionItem}>
                <dt>{k}</dt>
                <dd>
                  <span className={entry.skelValue} aria-hidden="true" />
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : state === 'unsupported' ? (
        <span className={[entry.help, entry.versionState].join(' ')}>
          Not supported by this environment (its Evaluation Service is older than v1.2).
        </span>
      ) : state === 'error' ? (
        <span className={[entry.errorText, entry.versionState].join(' ')}>
          Couldn’t read: Evaluation service could not read its versions (KB offline)
        </span>
      ) : (
        <dl className={entry.versionList}>
          {values.map(([k, v]) => (
            <div key={k} className={entry.versionItem}>
              <dt>{k}</dt>
              <dd>
                <Tag kind="version">{v}</Tag>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <span className={entry.versionRefresh}>
        <Button variant="ghost" size="sm" aria-label={`Refresh versions of ${env}`} onPress={noop}>
          Refresh
        </Button>
      </span>
    </div>
  );
}

function TaskLine({ env, task }: { env: string; task: TaskState }) {
  const items = [
    { key: '', label: 'Worker default' },
    ...TASKS.map((t) => ({ key: t.id, label: t.name, description: t.description ?? undefined })),
  ];
  return (
    <div className={styles.taskLine} data-env-task={env} data-status={task.kind}>
      <span className={entry.versionLabel}>Task</span>
      {task.kind === 'loading' ? (
        <>
          <span className={styles.srOnly} role="status">
            Reading tasks…
          </span>
          <span className={styles.taskSkel} aria-hidden="true" />
        </>
      ) : task.kind === 'error' ? (
        <span className={entry.errorText}>Couldn’t read tasks: {task.reason}</span>
      ) : task.kind === 'empty' ? (
        <Select
          label={`Task of ${env}`}
          hideLabel
          items={[{ key: '', label: 'No tasks listed' }]}
          value=""
          onChange={noop}
          isDisabled
        />
      ) : (
        <Select
          label={`Task of ${env}`}
          hideLabel
          items={items}
          value={task.value}
          onChange={noop}
          isDisabled={task.kind === 'readonly'}
        />
      )}
    </div>
  );
}

export function EnvBox({
  name,
  preset,
  versions = 'ok',
  task,
  shape,
  schemaTag,
  selected = true,
}: {
  name: string;
  /** An unticked box has no versions line and no task row. */
  selected?: boolean;
  preset?: boolean;
  versions?: VersionState;
  /** `undefined`: the service lists no tasks, the row does not exist. */
  task?: TaskState;
  shape?: ShapeNote;
  schemaTag?: string;
}) {
  return (
    <li className={entry.env} data-selected={selected ? 'true' : 'false'}>
      <Checkbox isSelected={selected} onChange={noop}>
        {name}
      </Checkbox>
      <span className={entry.envTags}>
        <Tag tone="success">Healthy</Tag>
        <Tag>Priority up to HIGH</Tag>
        {preset ? <Tag kind="version">Default preset v1</Tag> : null}
        {schemaTag ? <Tag tone="warning">{schemaTag}</Tag> : null}
        {shape ? (
          <Tag tone={shape.tone ?? 'info'} data-testid="env-shape-tag">
            {shape.text}
          </Tag>
        ) : null}
      </span>
      <span className={entry.envActions}>
        <Button size="sm" variant="ghost" onPress={noop}>
          Details
        </Button>
      </span>
      {selected ? <VersionLine state={versions} env={name} /> : null}
      {selected && task ? <TaskLine env={name} task={task} /> : null}
    </li>
  );
}

export function EnvCard({ children, latency = true }: { children: ReactNode; latency?: boolean }) {
  return (
    <Card>
      <div className={panel.cardStack}>
        <fieldset className={entry.fieldset}>
          <legend className={entry.legend}>Environments</legend>
          <ul className={entry.envList}>{children}</ul>
          <p className={entry.help}>
            Pick several to run the same configuration on each. Settings are the union of their forms.
          </p>
          <div>
            <Button size="sm" variant="neutral" icon={<Icon name="plus" />} onPress={noop}>
              New environment
            </Button>
          </div>
        </fieldset>
        {latency ? (
          <div className={entry.latencyBlock}>
            <div className={entry.latency}>
              <Checkbox isSelected={false} onChange={noop}>
                Latency-sensitive run
              </Checkbox>
              <p className={entry.checkHelp}>
                Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded
                and re-queued if foreign traffic overlaps. Expect a later start.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ───────────────────────────── the Datasets card ───────────────────────────── */

const ALL_DATASETS = [
  { key: 'billing-faq', label: 'billing-faq' },
  { key: 'refund-cases', label: 'refund-cases' },
  { key: 'support-tickets', label: 'support-tickets' },
];

function RefTags({ refs }: { refs: string[] }) {
  return (
    <span className={styles.refTags}>
      {refs.map((r) => (
        <Tag key={r} kind="version">
          {r}
        </Tag>
      ))}
    </span>
  );
}

function DatasetBox({ entry: e }: { entry: DsEntry }) {
  const keys = new Set<Key>(e.refs.map((r) => (r === 'Latest version' ? 'latest' : r)));
  return (
    <li className={styles.dsBox} data-dataset-box={e.name}>
      <span className={styles.dsName}>
        <span>{e.name}</span>
        {e.chip ? <Tag>{e.chip}</Tag> : null}
      </span>
      <IconButton label={`Remove ${e.name}`} icon="close" onPress={noop} />
      <div className={styles.dsRefs}>
        <MultiSelect
          label="Versions"
          items={e.offer.map((o) => ({ key: o === 'Latest version' ? 'latest' : o, label: o }))}
          value={keys}
          onChange={noop}
          searchable={false}
          selectAll={false}
          onlyAction={false}
          triggerVariant="bar"
          summary={(set) => String(set.size)}
        />
        <RefTags refs={e.refs} />
      </div>
    </li>
  );
}

const SHAPE_HELP: Record<'combined' | 'one_each', (n: number) => string> = {
  combined: (n) =>
    `One run over the ${n} dataset versions together. Every item records its dataset and version, and scores break down per dataset.`,
  one_each: (n) => `${n} runs per environment, one per dataset version, grouped under this experiment.`,
};

export function RunShape({ n, shape }: { n: number; shape: 'combined' | 'one_each' }) {
  return (
    <div className={styles.shapeBlock} data-testid="run-shape">
      <SegmentedControl
        label="Run shape"
        value={shape}
        onChange={noop}
        options={[
          { value: 'combined', label: 'Combine into one run' },
          { value: 'one_each', label: 'One run each' },
        ]}
      />
      <p className={entry.help}>{SHAPE_HELP[shape](n)}</p>
    </div>
  );
}

export function DatasetsCard({
  entries,
  shape = 'combined',
  chooseOnly,
}: {
  entries: DsEntry[];
  shape?: 'combined' | 'one_each';
  /** Today's picker: one Select, then the version Select (the zero-selection state). */
  chooseOnly?: boolean;
}) {
  const n = pairCount(entries);
  if (chooseOnly || !entries.length)
    return (
      <Card>
        <div className={panel.cardStack}>
          <div className={entry.stack}>
            <Select
              label="Dataset"
              items={ALL_DATASETS}
              value={null}
              onChange={noop}
              placeholder="Choose a dataset"
            />
          </div>
        </div>
      </Card>
    );
  return (
    <Card>
      <div className={panel.cardStack}>
        <fieldset className={entry.fieldset} data-testid="datasets-fieldset">
          <legend className={entry.legend}>Datasets</legend>
          <ul className={styles.dsList}>
            {entries.map((e) => (
              <DatasetBox key={e.name} entry={e} />
            ))}
          </ul>
          <div className={styles.dsFoot}>
            <Button size="sm" variant="neutral" icon={<Icon name="plus" />} onPress={noop}>
              Add another dataset
            </Button>
            <span className={entry.help} aria-live="polite" data-testid="pair-count">
              {n === 1
                ? '1 dataset version'
                : `${n} dataset versions from ${entries.length} ${entries.length === 1 ? 'dataset' : 'datasets'}`}
            </span>
          </div>
          {n > 1 ? <RunShape n={n} shape={shape} /> : null}
        </fieldset>
      </div>
    </Card>
  );
}

/* ───────────────────────────── start-from, name card, home bar ───────────────────────────── */

function StartCard() {
  return (
    <Card>
      <div className={panel.cardStack}>
        <div className={entry.startStack}>
          <Text variant="md" weight={600} as="h3">
            Start from
          </Text>
          <div className={entry.startGrid}>
            <div className={entry.card} role="radio" aria-checked="true" tabIndex={0}>
              <span className={entry.cardEyebrow}>Recommended</span>
              <span className={entry.cardTitle}>Default preset v1</span>
              <span className={entry.cardHint}>What this environment’s managers published.</span>
            </div>
            <div className={entry.card} role="radio" aria-checked="false" tabIndex={-1}>
              <span className={entry.cardEyebrow}>Best past run</span>
              <span className={entry.cardTitle}>Top-scoring run</span>
              <span className={entry.cardHint}>
                The configuration of a top-scoring official run on support-tickets and 1 more dataset.
              </span>
            </div>
            <div className={entry.card} role="radio" aria-checked="false" tabIndex={-1}>
              <span className={entry.cardEyebrow}>Copy an experiment</span>
              <span className={entry.cardTitle}>nightly baseline</span>
              <span className={entry.cardHint}>Your most recent experiment.</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HomeBarMock({
  runs = '5 runs to launch',
  status = 'Ready: Default preset v1 on production, staging',
}) {
  return (
    <div className={[entry.homeBar, styles.flowBar].join(' ')} role="region" aria-label="Launch">
      <TextField
        className={entry.homeName}
        label="Experiment name"
        hideLabel
        placeholder="Default preset v1 · production, staging · 2026-10-22"
        value=""
        onChange={noop}
      />
      <div className={entry.homeStatus}>
        <span role="status" className={entry.homeStatusText} data-tone="ok">
          {status}
        </span>
        <span className={entry.homeRuns} aria-live="polite">
          {runs}
        </span>
      </div>
      <div className={entry.homeActions}>
        <Button variant="accent" onPress={noop}>
          Launch as is
        </Button>
        <Button variant="neutral" onPress={noop}>
          Customize →
        </Button>
      </div>
    </div>
  );
}

function NewExperimentHeader() {
  return (
    <PageHeader
      title="New experiment"
      description="Pick where it runs and what to start from. You can change anything in Customize."
      actions={
        <Button variant="ghost" size="sm" onPress={noop}>
          All experiments
        </Button>
      }
    />
  );
}

/* ───────────────────────────── the two environment sets used by the pages ───────────────────────────── */

const SHAPE_PROD: ShapeNote = { text: '1 combined run', tone: 'info' };
const SHAPE_STAGING: ShapeNote = { text: '4 runs, one per dataset version (older service)', tone: 'warning' };

function MixedEnvs() {
  return (
    <>
      <EnvBox name="production" shape={SHAPE_PROD} task={{ kind: 'ok', value: 'answer-ticket' }} />
      <EnvBox name="staging" preset shape={SHAPE_STAGING} />
    </>
  );
}

/* ───────────────────────────── the review pane ───────────────────────────── */

export interface ReviewProblem {
  label: string;
  message: string;
}

export function ReviewMock({
  problems = [],
  entries = FOUR,
  shape = 'combined',
  envLines,
  runs = 5,
  math = '= 1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs',
  over,
}: {
  problems?: ReviewProblem[];
  entries?: DsEntry[];
  shape?: 'combined' | 'one_each';
  envLines?: Array<{ name: string; detail: string }>;
  runs?: number;
  math?: string;
  over?: boolean;
}) {
  const n = pairCount(entries);
  const lines = envLines ?? [
    { name: 'production', detail: '1 combined run of 4 dataset versions · task Answer a ticket' },
    {
      name: 'staging',
      detail: '4 runs, one per dataset version (older Evaluation Service) · Worker default task',
    },
  ];
  const detailed = n > 1 || lines.some((l) => !/^(Worker default|default)/.test(l.detail));
  return (
    <Card as="aside" aria-label="Review">
      <div className={review.pane}>
        <div className={review.head}>
          <Text variant="lg" as="h3">
            Review
          </Text>
          {problems.length ? (
            <Badge tone="danger">
              {problems.length} {problems.length === 1 ? 'problem' : 'problems'}
            </Badge>
          ) : (
            <Badge tone="success">Ready</Badge>
          )}
        </div>
        <KeyValueGrid
          columns={1}
          dense
          aria-label="Summary"
          items={[
            {
              key: 'env',
              label: 'Environments',
              value: detailed ? (
                <ul className={styles.envLines} data-testid="review-env-lines">
                  {lines.map((l) => (
                    <li key={l.name} className={styles.envLine}>
                      <span className={styles.envLineName}>{l.name}</span>
                      <span className={styles.envLineDetail}>{l.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                lines.map((l) => l.name).join(', ')
              ),
            },
            {
              key: 'ds',
              label: n > 1 ? 'Datasets' : 'Dataset',
              value: (
                <ul className={styles.pairLines} data-testid="review-datasets">
                  {entries.map((e) => (
                    <li key={e.name}>
                      <span className={styles.mono}>{e.name}</span>
                      <Text variant="sm" tone="muted" as="span">
                        {' '}
                        {e.refs.join(', ')}
                      </Text>
                    </li>
                  ))}
                </ul>
              ),
            },
            ...(n > 1
              ? [
                  {
                    key: 'shape',
                    label: 'Run shape',
                    value: shape === 'combined' ? 'Combine into one run' : 'One run each',
                  },
                ]
              : []),
            { key: 'base', label: 'Start from', value: 'Default preset v1 · production' },
            { key: 'prio', label: 'Priority', value: 'Environment default' },
            {
              key: 'versions',
              label: 'Versions',
              value: (
                <span className={entry.versionSummary}>
                  <span>production: agent-1.4.2 · img-20261001 · kb-77</span>
                  <span>staging: agent-1.4.2 · img-20261001 · kb-77</span>
                </span>
              ),
            },
          ]}
        />
        <div>
          <div className={review.runs} aria-live="polite">
            <span className={review.runsValue} data-over={over ? 'true' : 'false'}>
              {runs}
            </span>
            <Text variant="md" weight={600}>
              runs to launch
            </Text>
          </div>
          <p className={review.math}>{math}</p>
        </div>
        {over ? (
          <Callout tone="error" live title="Over the run limit">
            This would create {runs} runs; the limit is 64 per launch. Remove dataset versions, sweep values
            or environments, or choose “Combine into one run”.
          </Callout>
        ) : null}
        <section className={review.pane} aria-labelledby="mock-changes-title">
          <Text variant="md" weight={600} as="h4" id="mock-changes-title">
            Changes by step
          </Text>
          <ul className={review.changes}>
            <li className={review.change}>
              <span>Datasets changed</span>
              <Button size="sm" variant="ghost" onPress={noop}>
                Edit
              </Button>
            </li>
          </ul>
        </section>
        <section className={review.pane} aria-labelledby="mock-valid-title">
          <Text variant="md" weight={600} as="h4" id="mock-valid-title">
            {problems.length
              ? `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} to fix`
              : 'Validation'}
          </Text>
          {problems.length ? (
            <ul className={review.changes}>
              {problems.map((p) => (
                <li key={p.label + p.message} className={review.change}>
                  <span>
                    <Text variant="base" weight={600} as="span">
                      {p.label}
                    </Text>
                    <br />
                    <button type="button" className={review.problemLink}>
                      {p.message}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Text variant="base" className={review.ok} role="status">
              Checked just now: nothing to fix.
            </Text>
          )}
        </section>
        <div className={review.actions}>
          <Button variant="ghost" onPress={noop}>
            Cancel
          </Button>
          <Button variant="neutral" onPress={noop}>
            Raw JSON
          </Button>
          <Button variant="accent" isDisabled={problems.length > 0} onPress={noop}>
            Launch {runs} runs
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────────── Customize step 1 (composed) ───────────────────────────── */

const STEPS = [
  { id: 'where', label: 'Where it runs' },
  { id: 'start', label: 'Starting point' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Environment configurations' },
  { id: 'evaluation', label: 'Evaluation configurations' },
  { id: 'review', label: 'Review and launch' },
];

function Step1Page({ review: pane }: { review: ReactNode }) {
  return (
    <>
      <NewExperimentHeader />
      <div className={styles.layout} data-aside="">
        <div className={styles.main}>
          <Stepper aria-label="Steps" steps={STEPS} current="where" onSelect={noop} />
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Where it runs</h2>
            <p className={entry.help}>
              Name the experiment, set its priority and pick the environments and dataset.
            </p>
          </div>
          <div className={entry.entry} data-testid="launch-entry-mock">
            <Card as="section" aria-label="Name and priority">
              <div className={panel.cardStack}>
                <div className={entry.stack}>
                  <div className={entry.row}>
                    <TextField label="Experiment name" value="support evals, Oct" onChange={noop} />
                    <Select
                      label="Priority"
                      items={[{ key: '', label: 'Environment default (NORMAL)' }]}
                      value=""
                      onChange={noop}
                    />
                  </div>
                </div>
              </div>
            </Card>
            <div className={entry.where}>
              <EnvCard latency={false}>
                <MixedEnvs />
              </EnvCard>
              <DatasetsCard entries={FOUR} />
            </div>
          </div>
          <div className={styles.stepNav}>
            <Button variant="ghost" onPress={noop}>
              Cancel
            </Button>
            <Button variant="neutral" onPress={noop}>
              Continue →
            </Button>
          </div>
        </div>
        <div>{pane}</div>
      </div>
    </>
  );
}

/* ───────────────────────────── review step and raw JSON ───────────────────────────── */

const RAW_JSON = `{
  "evaluator": {
    "dataset": "support-tickets",
    "dataset_version": "v3",
    "datasets": [
      { "dataset": "support-tickets", "version": "v3", "alias": null },
      { "dataset": "support-tickets", "version": "v4", "alias": null },
      { "dataset": "billing-faq", "version": "v1", "alias": null },
      { "dataset": "billing-faq", "version": "v2", "alias": null }
    ],
    "run_shape": "combined",
    "task": { "<production id>": "answer-ticket" },
    "config": { "samples": 1 }
  },
  "slot_bindings": { "endpoint:primary": { "connection_id": "c-gpt4o" } },
  "env_overrides": {}
}`;

function RawJsonCard({ error }: { error?: string }) {
  return (
    <Card as="section" aria-label="Raw JSON">
      <div className={panel.cardStack}>
        <SectionHeader
          title="Raw JSON"
          description="The experiment document as it is sent. Apply to update the form from the text."
        />
        <pre className={styles.code} data-testid="raw-json">
          {RAW_JSON}
        </pre>
        {error ? (
          <Callout tone="error" live title="Not applied">
            {error}
          </Callout>
        ) : null}
        <div className={review.actions}>
          <Button variant="ghost" onPress={noop}>
            Revert to form
          </Button>
          <Button variant="neutral" onPress={noop}>
            Apply
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ReviewPage() {
  return (
    <>
      <NewExperimentHeader />
      <div className={styles.layout}>
        <div className={styles.main}>
          <Stepper aria-label="Steps" steps={STEPS} current="review" onSelect={noop} />
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Review and launch</h2>
            <p className={entry.help}>Check the summary, then launch.</p>
          </div>
          <ReviewMock />
          <RawJsonCard />
        </div>
      </div>
    </>
  );
}

/* ───────────────────────────── experiment detail ───────────────────────────── */

interface JobRow {
  id: string;
  group: string;
  env: string;
  task: string;
  status: string;
  run: string;
  updated: string;
}

const GROUP_ALL = 'All 4 dataset versions · one combined run';
const JOBS: JobRow[] = [
  {
    id: 'j0',
    group: GROUP_ALL,
    env: 'production',
    task: 'Answer a ticket',
    status: 'RUNNING',
    run: 'nightly multi-dataset',
    updated: '2 min ago',
  },
  {
    id: 'j1',
    group: 'support-tickets · v3',
    env: 'staging',
    task: 'Worker default',
    status: 'SUCCEEDED',
    run: 'nightly multi-dataset · staging',
    updated: '9 min ago',
  },
  {
    id: 'j2',
    group: 'support-tickets · v3',
    env: 'qa-lab',
    task: 'Worker default',
    status: 'RUNNING',
    run: 'nightly multi-dataset · qa-lab',
    updated: '1 min ago',
  },
  {
    id: 'j3',
    group: 'support-tickets · v4',
    env: 'staging',
    task: 'Worker default',
    status: 'SUCCEEDED',
    run: 'nightly multi-dataset · staging',
    updated: '6 min ago',
  },
  {
    id: 'j4',
    group: 'support-tickets · v4',
    env: 'qa-lab',
    task: 'Worker default',
    status: 'QUEUED',
    run: '—',
    updated: '10 min ago',
  },
  {
    id: 'j5',
    group: 'billing-faq · v1',
    env: 'staging',
    task: 'Worker default',
    status: 'RUNNING',
    run: 'nightly multi-dataset · staging',
    updated: 'just now',
  },
  {
    id: 'j6',
    group: 'billing-faq · v1',
    env: 'qa-lab',
    task: 'Worker default',
    status: 'QUEUED',
    run: '—',
    updated: '10 min ago',
  },
  {
    id: 'j7',
    group: 'billing-faq · v2',
    env: 'staging',
    task: 'Worker default',
    status: 'QUEUED',
    run: '—',
    updated: '10 min ago',
  },
  {
    id: 'j8',
    group: 'billing-faq · v2',
    env: 'qa-lab',
    task: 'Worker default',
    status: 'QUEUED',
    run: '—',
    updated: '10 min ago',
  },
];

function JobsTable() {
  const columns: Column<JobRow>[] = [
    { id: 'env', header: 'Environment', width: 150, priority: 1, cell: (j) => j.env },
    { id: 'task', header: 'Task', width: 170, priority: 3, cell: (j) => j.task },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 140,
      priority: 1,
      cell: (j) => <JobStatusBadge status={j.status} />,
    },
    { id: 'run', header: 'Run', width: 240, flex: true, priority: 2, cell: (j) => j.run },
    { id: 'updated', header: 'Updated', type: 'date', width: 110, priority: 2, cell: (j) => j.updated },
  ];
  return (
    <DataTable<JobRow>
      aria-label="Job history"
      density="regular"
      rows={JOBS}
      rowKey={(j) => j.id}
      columns={columns}
      groupBy={{
        key: (j) => j.group,
        label: (k) => (
          <span className={styles.jobDataset} data-job-group={k}>
            <Tag kind="dataset">{k}</Tag>
          </span>
        ),
        collapsible: true,
      }}
    />
  );
}

interface MatrixRow {
  key: string;
  label: string;
  sub: string;
  cells: Array<[string, string] | null>;
}

/** Matrix rows are (combination, dataset): the combined job sits on its own row, every fanned-out pair on one row. */
function MatrixMock() {
  const envs = ['production', 'staging', 'qa-lab'];
  const rows: MatrixRow[] = [
    { key: 'all', label: 'All 4 dataset versions', sub: 'combined', cells: [['RUNNING', ''], null, null] },
    {
      key: 'a',
      label: 'support-tickets · v3',
      sub: '#0 · pair 1',
      cells: [null, ['SUCCEEDED', '0.84'], ['RUNNING', '']],
    },
    {
      key: 'b',
      label: 'support-tickets · v4',
      sub: '#0 · pair 2',
      cells: [null, ['SUCCEEDED', '0.81'], ['QUEUED', '']],
    },
    {
      key: 'c',
      label: 'billing-faq · v1',
      sub: '#0 · pair 3',
      cells: [null, ['RUNNING', ''], ['QUEUED', '']],
    },
    {
      key: 'd',
      label: 'billing-faq · v2',
      sub: '#0 · pair 4',
      cells: [null, ['QUEUED', ''], ['QUEUED', '']],
    },
  ];
  const cell = (c: [string, string] | null) =>
    c ? (
      <div className={detail.cell}>
        <div className={detail.cellTop}>
          <JobStatusBadge status={c[0]} />
        </div>
        {c[1] ? (
          <div className={detail.metric}>
            <span className={detail.metricValue}>{c[1]}</span>
            <span className={detail.metricName}>accuracy</span>
          </div>
        ) : null}
      </div>
    ) : (
      <span className={detail.sub}>—</span>
    );
  const columns: Column<MatrixRow>[] = [
    {
      id: 'combo',
      header: 'Combination',
      width: 260,
      priority: 1,
      cell: (r) => (
        <span data-dataset-row={r.key}>
          <span className={detail.comboLabel}>{r.label}</span>
          <span className={[detail.sub, detail.mono].join(' ')}> {r.sub}</span>
        </span>
      ),
    },
    ...envs.map((e, i): Column<MatrixRow> => ({
      id: e,
      header: e,
      flex: true,
      minWidth: 160,
      priority: 1,
      cell: (r) => cell(r.cells[i] ?? null),
    })),
  ];
  return (
    <Card as="section" aria-labelledby="mock-matrix-title" data-exp-matrix>
      <div className={detail.stack}>
        <SectionHeader
          id="mock-matrix-title"
          title="Matrix"
          description="1 combination × 3 environments, one row per dataset version where an environment ran them one by one. Each cell is the latest attempt."
        />
        <DataTable<MatrixRow>
          aria-label="Matrix"
          density="regular"
          rows={rows}
          rowKey={(r) => r.key}
          columns={columns}
        />
      </div>
    </Card>
  );
}

function DetailPage() {
  return (
    <>
      <span className={detail.back}>← All experiments</span>
      <PageHeader
        title={
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}
          >
            nightly multi-dataset
            <Badge tone="info">running</Badge>
          </span>
        }
        description="Jobs launched by this experiment, one per combination, environment and (where a service takes no list) dataset version."
        meta={[
          'dev@local',
          '12 minutes ago',
          'Priority Normal',
          'Base: Default preset v1',
          'production, staging, qa-lab',
        ]}
      />
      <div className={detail.headerActions}>
        <Button variant="danger" size="md" onPress={noop}>
          Cancel experiment
        </Button>
      </div>
      <Card as="section" aria-label="Datasets and task" tone="meta">
        <div className={panel.cardStack}>
          <KeyValueGrid
            columns={2}
            aria-label="Datasets and task"
            items={[
              {
                key: 'datasets',
                label: 'Datasets',
                value: (
                  <span className={styles.refTags} data-testid="detail-datasets">
                    <Tag kind="dataset">support-tickets · v3</Tag>
                    <Tag kind="dataset">support-tickets · v4</Tag>
                    <Tag kind="dataset">billing-faq · v1</Tag>
                    <Tag kind="dataset">billing-faq · v2</Tag>
                  </span>
                ),
              },
              { key: 'shape', label: 'Run shape', value: 'Combine into one run' },
              {
                key: 'sent',
                label: 'What each environment ran',
                value: (
                  <ul className={styles.envLines} data-testid="detail-env-lines">
                    <li className={styles.envLine}>
                      <span className={styles.envLineName}>production</span>
                      <span className={styles.envLineDetail}>1 combined run · task Answer a ticket</span>
                    </li>
                    <li className={styles.envLine}>
                      <span className={styles.envLineName}>staging</span>
                      <span className={styles.envLineDetail}>
                        4 jobs, one per dataset version (older Evaluation Service) · Worker default task
                      </span>
                    </li>
                    <li className={styles.envLine}>
                      <span className={styles.envLineName}>qa-lab</span>
                      <span className={styles.envLineDetail}>
                        4 jobs, one per dataset version (older Evaluation Service) · Worker default task
                      </span>
                    </li>
                  </ul>
                ),
              },
            ]}
          />
        </div>
      </Card>
      <StatStrip
        aria-label="Job totals"
        items={[
          { key: 'jobs', label: 'Jobs', value: 9 },
          { key: 'ok', label: 'Succeeded', value: 2, tone: 'success' },
          { key: 'failed', label: 'Failed', value: 0 },
          { key: 'live', label: 'In progress', value: 3, tone: 'accent' },
          { key: 'cancelled', label: 'Cancelled', value: 0 },
        ]}
      />
      <MatrixMock />
      <Card as="section" aria-labelledby="mock-history-title">
        <div className={panel.cardStack}>
          <SectionHeader
            id="mock-history-title"
            title="Job history"
            description="Refreshing automatically while jobs are queued or running. Grouped by dataset version."
          />
          <JobsTable />
        </div>
      </Card>
    </>
  );
}

/* ───────────────────────────── gallery wrapper ───────────────────────────── */

function Sheet({ children }: { children: ReactNode }) {
  return <div className={styles.sheet}>{children}</div>;
}

function Col({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.sheetCol}>
      <p className={styles.label}>{title}</p>
      {children}
    </div>
  );
}

function EnvList({ children }: { children: ReactNode }) {
  return <ul className={entry.envList}>{children}</ul>;
}

function VersionPopover({ entry: e, checked }: { entry: DsEntry; checked: string[] }) {
  return (
    <div className={styles.popoverStatic} role="group" aria-label={`Versions of ${e.name}`}>
      <p className={styles.popHint}>Versions of {e.name}. Tick several to evaluate each of them.</p>
      {e.offer.map((o) => (
        <div key={o} className={styles.popRow}>
          <Checkbox isSelected={checked.includes(o)} onChange={noop}>
            {o}
          </Checkbox>
          {o === 'v4' ? <Tag tone="warning">draft</Tag> : null}
          {o === 'v3' ? <Tag kind="version">production</Tag> : null}
        </div>
      ))}
    </div>
  );
}

export function MultiLaunchMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="multi-launch" title="Multi-dataset and task launch (WP-D design contract)">
      <Case
        wide
        label="md-page-home (QD-1: the launch home view, 2 datasets x 2 versions, one combined run on production, one job per dataset version on an older staging service, a task chosen for production)"
      >
        <Shell crumbs={['Experiments', 'New experiment']}>
          <div className={entry.home} data-testid="launch-home-mock">
            <NewExperimentHeader />
            <div className={entry.where}>
              <EnvCard>
                <MixedEnvs />
              </EnvCard>
              <DatasetsCard entries={FOUR} />
            </div>
            <StartCard />
            <HomeBarMock />
          </div>
        </Shell>
      </Case>
      <Case
        wide
        label="md-page-step1 (QD-2: Customize step 1 with the same Datasets card and environment boxes; the review pane at the right from 1100 px, below the step under it)"
      >
        <Shell crumbs={['Experiments', 'New experiment']}>
          <Step1Page review={<ReviewMock />} />
        </Shell>
      </Case>
      <Case
        wide
        label="md-page-review (QD-3: Review and launch with per-environment lines, run shape and Raw JSON)"
      >
        <Shell crumbs={['Experiments', 'New experiment']}>
          <ReviewPage />
        </Shell>
      </Case>
      <Case
        wide
        label="md-page-detail (QD-4: experiment detail, a combined job and fanned-out jobs grouped by dataset version)"
      >
        <Shell crumbs={['Experiments', 'nightly multi-dataset']}>
          <DetailPage />
        </Shell>
      </Case>

      <Case
        wide
        label="md-s-single (QD-5: one dataset on Latest version and nothing chosen, at the real column: today's picker, the box and the bar, plus the Versions line)"
      >
        <div className={styles.col} data-testid="real-col">
          <p className={styles.label}>Nothing chosen: today's Select, 24 px, two clicks to a dataset</p>
          <div className={entry.where}>
            <EnvCard latency={false}>
              <EnvBox name="production" selected={false} />
              <EnvBox name="staging" selected={false} />
            </EnvCard>
            <DatasetsCard entries={[]} chooseOnly />
          </div>
          <p className={styles.label}>One dataset on Latest version: no run shape, no environment tag</p>
          <div className={entry.where}>
            <EnvCard latency={false}>
              <EnvBox name="production" task={{ kind: 'ok', value: '' }} />
              <EnvBox name="staging" selected={false} />
            </EnvCard>
            <DatasetsCard
              entries={[{ name: 'support-tickets', refs: ['Latest version'], offer: SUPPORT.offer }]}
            />
          </div>
        </div>
      </Case>
      <Case label="md-s-picker (QD-6: the version list of a dataset, the add control, a restricted dataset)">
        <Sheet>
          <Col title="Versions popover (checkboxes; Latest version is one of them)">
            <VersionPopover entry={SUPPORT} checked={['v3', 'v4']} />
          </Col>
          <Col title="Last version unticked: snaps back to Latest version (announced)">
            <VersionPopover entry={SUPPORT} checked={['Latest version']} />
          </Col>
          <Col title="Two datasets, one version each (2 dataset versions)">
            <DatasetsCard
              entries={[
                { ...SUPPORT, refs: ['Latest version'] },
                { ...BILLING, refs: ['alias production'] },
              ]}
            />
          </Col>
        </Sheet>
      </Case>
      <Case label="md-s-shape (QD-7: the run shape control, both values, hidden below two pairs)">
        <Sheet>
          <Col title="Combine into one run (default)">
            <RunShape n={4} shape="combined" />
          </Col>
          <Col title="One run each">
            <RunShape n={4} shape="one_each" />
          </Col>
          <Col title="Two pairs">
            <RunShape n={2} shape="combined" />
          </Col>
        </Sheet>
      </Case>
      <Case label="md-s-task (QD-8: the task row in an environment box, every state)">
        <Sheet>
          <Col title="Chosen (production)">
            <EnvList>
              <EnvBox name="production" task={{ kind: 'ok', value: 'answer-ticket' }} />
            </EnvList>
          </Col>
          <Col title="Worker default (first option)">
            <EnvList>
              <EnvBox name="production" task={{ kind: 'ok', value: '' }} />
            </EnvList>
          </Col>
          <Col title="Reading the list (same height as loaded)">
            <EnvList>
              <EnvBox name="production" task={{ kind: 'loading' }} />
            </EnvList>
          </Col>
          <Col title="The service lists no tasks (disabled select keeps the row)">
            <EnvList>
              <EnvBox name="production" task={{ kind: 'empty' }} />
            </EnvList>
          </Col>
          <Col title="The service could not read its tasks (503)">
            <EnvList>
              <EnvBox name="production" task={{ kind: 'error', reason: 'registry offline' }} />
            </EnvList>
          </Col>
          <Col title="Service answers 404 / 405 / 422: no row at all">
            <EnvList>
              <EnvBox name="staging" />
            </EnvList>
          </Col>
          <Col title="Archived project: read only">
            <EnvList>
              <EnvBox name="production" task={{ kind: 'readonly', value: 'answer-ticket' }} />
            </EnvList>
          </Col>
        </Sheet>
      </Case>
      <Case label="md-s-env (QD-9: mixed environments, what each box says it will receive)">
        <Sheet>
          <Col title="Takes a list, combined">
            <EnvList>
              <EnvBox name="production" shape={SHAPE_PROD} task={{ kind: 'ok', value: 'route-ticket' }} />
            </EnvList>
          </Col>
          <Col title="Takes a list, One run each">
            <EnvList>
              <EnvBox
                name="production"
                shape={{ text: '4 runs, one per dataset version', tone: 'info' }}
                task={{ kind: 'ok', value: '' }}
              />
            </EnvList>
          </Col>
          <Col title="Older service, Combine chosen: fan-out note (warning tone)">
            <EnvList>
              <EnvBox name="staging" shape={SHAPE_STAGING} />
            </EnvList>
          </Col>
          <Col title="Older service, One run each (no deviation, neutral)">
            <EnvList>
              <EnvBox name="staging" shape={{ text: '4 runs, one per dataset version', tone: 'info' }} />
            </EnvList>
          </Col>
          <Col title="No evaluator schema yet (checking): treated as older service">
            <EnvList>
              <EnvBox name="qa-lab" schemaTag="No schema" shape={SHAPE_STAGING} />
            </EnvList>
          </Col>
        </Sheet>
      </Case>
      <Case label="md-s-problems (QD-10: review pane problems and the run limit)">
        <Sheet>
          <Col title="Problems">
            <ReviewMock
              problems={[
                { label: 'Datasets', message: 'billing-faq: choose at least one version.' },
                { label: 'Task', message: 'production: the service does not list the task “route-ticket”.' },
                { label: 'Datasets', message: 'support-tickets v3 is chosen twice.' },
              ]}
            />
          </Col>
          <Col title="Over the run limit (13 datasets versions, One run each, 6 environments would be 78)">
            <ReviewMock
              shape="one_each"
              runs={78}
              over
              math="= 1 combination × (6 environments × 13 dataset versions) = 78 runs"
              envLines={[
                { name: 'production', detail: '13 runs, one per dataset version · Worker default task' },
                { name: 'staging', detail: '13 runs, one per dataset version · Worker default task' },
              ]}
            />
          </Col>
        </Sheet>
      </Case>
      <Case label="md-s-raw (QD-11: Raw JSON with datasets, run_shape and task, and its errors)">
        <Sheet>
          <Col title="Applied form">
            <RawJsonCard />
          </Col>
          <Col title="Rejected text">
            <RawJsonCard error="/evaluator/datasets/1: give a version or an alias, not both." />
          </Col>
        </Sheet>
      </Case>
    </Sec>
  );
}
