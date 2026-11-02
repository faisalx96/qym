/**
 * WP-B mocks (design stage): static visual contracts for docs/internal/feature-rounds/2026-10-dataset-access/spec-b.md.
 * Primitives and tokens only; nothing here reads the API. The CSS in EvalFlagsMocks.module.css is the proposed recipe.
 * Cases: ef-run-settings (B5), ef-review (B5, B4), ef-dataset (B4), ef-detail-header (B4, B5), ef-jobs (B5),
 * ef-list-queue (B5), ef-env-form (B5), ef-tokens (B4).
 */
import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Eyebrow,
  KeyValueGrid,
  PageHeader,
  Select,
  Tag,
  Text,
  TextField,
  TwoLine,
  type Column,
} from '@/ui';
import { Callout } from '@/features/experiments/launch/components/Callout';
import panel from '@/features/experiments/launch/components/launch.module.css';
import { JobStatusBadge, ExperimentStatusBadge } from '@/features/experiments/components/StatusBadges';
import { Section as EnvSection } from '@/features/environments/Section';
import envStyles from '@/features/environments/EnvironmentPage.module.css';
import styles from './EvalFlagsMocks.module.css';

const noop = () => undefined;

/** The one Latency-sensitive tag recipe: sans, info tone, passive (detail header, list, queue, review). */
function LatencyTag() {
  return (
    <Tag tone="info" data-testid="latency-tag">
      Latency-sensitive
    </Tag>
  );
}

/* ───────────────────────────── B5: launch step 1, Run settings ───────────────────────────── */

export const LATENCY_HELPER =
  'Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.';

type RunMode = 'off' | 'on' | 'on-partial' | 'disabled-all' | 'readonly';

function RunSettingsMock({ mode }: { mode: RunMode }) {
  const checked = mode === 'on' || mode === 'on-partial';
  const disabled = mode === 'disabled-all' || mode === 'readonly';
  return (
    <Card as="section" aria-label="Name and priority">
      <div className={panel.cardStack}>
        <div className={styles.sm} data-testid="launch-run-settings">
          <div className={styles.row}>
            <TextField label="Experiment name" value="timeout sweep" onChange={noop} isDisabled={mode === 'readonly'} />
            <Select
              label="Priority"
              items={[{ key: '', label: 'Environment default (NORMAL)' }]}
              value=""
              onChange={noop}
              isDisabled={mode === 'readonly'}
            />
          </div>
          <div className={styles.latency} data-testid="launch-latency">
            <Checkbox isSelected={checked} isDisabled={disabled} onChange={noop}>
              Latency-sensitive run
            </Checkbox>
            <p className={styles.checkHelp}>{LATENCY_HELPER}</p>
            {mode === 'disabled-all' ? (
              <p className={styles.checkReason} data-testid="launch-latency-reason">
                Only project managers can launch latency-sensitive runs on production.
              </p>
            ) : null}
          </div>
          {checked ? (
            <Callout tone="warning" title="Other jobs wait while this run executes" className={styles.callout}>
              {mode === 'on-partial' ? (
                <span>Only a project manager can launch it on production. Clear the box or ask a project manager.</span>
              ) : null}
            </Callout>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────────── B5 / B4: review pane ───────────────────────────── */

type ReviewMode = 'on' | 'blocked' | 'warnings';

function ReviewMock({ mode }: { mode: ReviewMode }) {
  const problem = mode === 'blocked';
  return (
    <Card as="aside" aria-label="Review">
      <div className={styles.pane}>
        <div className={styles.head}>
          <Text variant="lg" as="h3">
            Review
          </Text>
          {problem ? <Badge tone="danger">1 problem</Badge> : <Badge tone="success">Ready</Badge>}
        </div>
        <KeyValueGrid
          columns={1}
          dense
          aria-label="Summary"
          items={[
            { key: 'env', label: 'Environments', value: mode === 'warnings' ? 'staging' : 'staging, production' },
            { key: 'ds', label: 'Dataset', value: 'golden', mono: true },
            { key: 'base', label: 'Start from', value: 'Default preset v1' },
            { key: 'prio', label: 'Priority', value: 'Environment default' },
            { key: 'latency', label: 'Latency-sensitive', value: 'yes' },
            { key: 'versions', label: 'Versions', value: 'agent-1.4.2 · img-20261001 · kb-77' },
          ]}
        />
        <div className={styles.runs}>
          <span className={styles.runsValue}>{mode === 'warnings' ? 3 : 6}</span>
          <Text variant="md" weight={600}>
            runs to launch
          </Text>
        </div>
        {mode === 'warnings' ? (
          <>
            <Callout tone="warning" title="Post-run ceiling not set">
              <span>
                No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)
              </span>
              <div className={styles.calloutRow}>
                <Button size="sm" variant="neutral" onPress={noop}>
                  Set ceiling
                </Button>
              </div>
            </Callout>
            <Callout tone="warning" title="Dataset read token will not be sent">
              <span>
                The schema of staging does not declare{' '}
                <Text variant="base" as="span" mono>
                  QYM_DATASET_READ_TOKEN
                </Text>
                , so “golden” (restricted) is read with the worker’s own token.
              </span>
            </Callout>
          </>
        ) : null}
        <section aria-labelledby="ef-validation" className={styles.pane}>
          <Text variant="md" weight={600} as="h4" id="ef-validation">
            {problem ? '1 problem to fix' : 'Validation'}
          </Text>
          {problem ? (
            <ul className={panel.problems} aria-label="Problems to fix">
              <li>
                <button type="button" className={panel.problem}>
                  <span className={panel.problemLabel}>Latency-sensitive</span>
                  <span>Latency-sensitive runs on production need a project manager</span>
                </button>
              </li>
            </ul>
          ) : (
            <Text variant="base" role="status">
              Nothing to fix.
            </Text>
          )}
        </section>
      </div>
    </Card>
  );
}

/* ───────────────────────────── B4: launch dataset picker ───────────────────────────── */

interface Ds {
  key: string;
  label: string;
  chip?: 'Restricted' | 'Private test set';
}

const DATASETS: Ds[] = [
  { key: 'golden', label: 'golden', chip: 'Restricted' },
  { key: 'support-eval', label: 'support-eval', chip: 'Private test set' },
  { key: 'intake-v2', label: 'intake-v2' },
];

function DatasetName({ d }: { d: Ds }) {
  return (
    <span className={styles.optionName}>
      {d.label}
      {d.chip ? <Tag data-testid="dataset-chip">{d.chip}</Tag> : null}
    </span>
  );
}

export const TOKEN_HELP =
  'Restricted dataset. The experiment reads it with its own dataset read token; people without access to the dataset see this run’s scores, not its item contents.';

function DatasetMock({ selected, open }: { selected: string; open?: boolean }) {
  const current = DATASETS.find((d) => d.key === selected);
  return (
    <Card>
      <div className={panel.cardStack}>
        <div className={styles.sm} data-testid="launch-dataset">
          <Select
            label="Dataset"
            items={DATASETS}
            value={selected}
            onChange={noop}
            renderItem={(d) => <DatasetName d={d as Ds} />}
          />
          {open ? (
            <ul className={styles.options} role="listbox" aria-label="Datasets (open list)">
              {DATASETS.map((d) => (
                <li key={d.key} role="option" aria-selected={d.key === selected} className={styles.option} data-selected={d.key === selected ? '' : undefined}>
                  <DatasetName d={d} />
                </li>
              ))}
            </ul>
          ) : null}
          {current?.chip ? (
            <p className={styles.copy} data-testid="dataset-token-help">
              {current.chip === 'Restricted'
                ? TOKEN_HELP
                : 'Private test set. The experiment reads it with its own dataset read token; only admins see its item contents.'}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────────── B4 / B5: experiment detail header ───────────────────────────── */

type CredState = 'active' | 'revoked' | 'none';

function CredBadge({ state, at }: { state: CredState | 'not-sent'; at?: string }) {
  if (state === 'active') return <Badge tone="success">active</Badge>;
  if (state === 'revoked') return <Badge tone="neutral">revoked {at}</Badge>;
  if (state === 'not-sent') return <Badge tone="warning">not sent</Badge>;
  return <Badge tone="neutral">not issued</Badge>;
}

interface HeaderProps {
  latency?: boolean;
  api: CredState;
  token: CredState | 'not-sent';
  at?: string;
  notice?: ReactNode;
  warn?: boolean;
  status?: string;
}

function HeaderMock({ latency, api, token, at, notice, warn, status = 'RUNNING' }: HeaderProps) {
  return (
    <div className={styles.page} data-testid="exp-header-mock">
      <PageHeader
        title={
          <span className={styles.titleRow}>
            timeout sweep
            <ExperimentStatusBadge status={status} />
            {latency ? <LatencyTag /> : null}
          </span>
        }
        description="Timeout 10/30/60"
        meta={['dev@local', '5 min ago', 'Priority Normal', 'Base: Blank', 'staging, production']}
      />
      <section className={styles.creds} aria-label="Credentials" data-testid="exp-credentials">
        <Eyebrow>Credentials</Eyebrow>
        <dl className={styles.credList}>
          <div className={styles.credItem}>
            <dt className={styles.credName}>API key</dt>
            <dd className={styles.credValue} data-testid="cred-api-key">
              <CredBadge state={api} at={at} />
            </dd>
          </div>
          <div className={styles.credItem}>
            <dt className={styles.credName}>Dataset read token</dt>
            <dd className={styles.credValue} data-testid="cred-dataset-token">
              <CredBadge state={token} at={at} />
            </dd>
          </div>
        </dl>
      </section>
      {notice ? <Callout tone={warn ? 'warning' : 'info'}>{notice}</Callout> : null}
    </div>
  );
}

const REVOKED_NOTICE = (
  <span data-testid="token-notice">Dataset read token revoked 12:41. Retry the blocked jobs to issue a new one.</span>
);
const ENV_NOTICE_ONE = (
  <span data-testid="token-notice">
    Dataset read token not sent to staging: the environment’s schema does not declare{' '}
    <Text variant="base" as="span" mono>
      QYM_DATASET_READ_TOKEN
    </Text>
    . Its jobs read datasets with the Evaluation Service’s own token.
  </span>
);
const ENV_NOTICE_ALL = (
  <span data-testid="token-notice">
    Dataset read token not sent to staging, production: the environments’ schemas do not declare{' '}
    <Text variant="base" as="span" mono>
      QYM_DATASET_READ_TOKEN
    </Text>
    . Their jobs read datasets with the Evaluation Service’s own token.
  </span>
);

/* ───────────────────────────── B5: jobs table, status cell ───────────────────────────── */

interface JobRow {
  id: string;
  n: number;
  env: string;
  params: string;
  status: string;
  error?: string;
  deferrals?: number;
  reason?: string;
  admitted?: string;
  contaminated?: number;
  wait?: string;
}

const JOBS: JobRow[] = [
  { id: 'j0', n: 0, env: 'staging', params: 'timeout=10', status: 'SUCCEEDED', contaminated: 1 },
  { id: 'j1', n: 1, env: 'staging', params: 'timeout=30', status: 'RUNNING', admitted: '12:52' },
  { id: 'j2', n: 2, env: 'staging', params: 'timeout=60', status: 'QUEUED', deferrals: 3, reason: 'vllm quiet window' },
  { id: 'j3', n: 0, env: 'production', params: 'timeout=10', status: 'QUEUED', deferrals: 1, reason: 'gateway quiet window', contaminated: 1 },
  { id: 'j4', n: 1, env: 'production', params: 'timeout=30', status: 'FAILED', error: 'giving up after 3 discarded run(s)', contaminated: 3 },
  { id: 'j5', n: 2, env: 'production', params: 'timeout=60', status: 'BLOCKED', error: 'The experiment’s dataset read token is unavailable; retry to issue a new one' },
];

/** The status cell's secondary line, in the precedence the spec fixes (B5-27). */
export function admissionLine(j: JobRow): { text: string; error?: boolean } | null {
  if (j.error) return { text: j.error, error: true };
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(j.status);
  if (!terminal && j.deferrals && !j.admitted) return { text: `deferred ×${j.deferrals} · ${j.reason ?? ''}`.trim() };
  if (j.status === 'RUNNING' && j.admitted) return { text: `admitted ${j.admitted}` };
  if (j.contaminated) return { text: `re-queued ×${j.contaminated} · contaminated` };
  if (j.wait) return { text: j.wait };
  return null;
}

function jobColumns(latency: boolean): Column<JobRow>[] {
  return [
    { id: 'combo', header: 'Combo', type: 'id', width: 80, pin: 'start', hideable: false, priority: 1, cell: (j) => `#${j.n}` },
    { id: 'environment', header: 'Environment', width: 150, priority: 2, cell: (j) => j.env },
    { id: 'params', header: 'Params', width: 220, flex: true, priority: 3, cell: (j) => <span className={styles.mono}>{j.params}</span> },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: latency ? 240 : 200,
      priority: 1,
      cell: (j) => {
        const line = latency ? admissionLine(j) : j.error ? { text: j.error, error: true } : null;
        return (
          <TwoLine
            primary={
              <span className={styles.jobTitle}>
                <JobStatusBadge status={j.status} />
                {latency && j.contaminated ? (
                  <Tag kind="count" tone="info" aria-label={`re-queued ${j.contaminated} times`} data-testid="requeue-tag">
                    ↻ {j.contaminated}
                  </Tag>
                ) : null}
              </span>
            }
            secondary={line ? <span className={line.error ? styles.errorText : undefined}>{line.text}</span> : undefined}
          />
        );
      },
    },
    { id: 'attempt', header: 'Attempt', type: 'number', width: 90, priority: 3, cell: () => 1 },
    { id: 'run', header: 'Run', width: 180, priority: 2, cell: () => '—' },
    { id: 'updated', header: 'Updated', type: 'date', width: 110, priority: 2, cell: () => '2 min ago' },
  ];
}

function JobsMock({ latency }: { latency: boolean }) {
  return (
    <Card as="section" aria-label="Job history (mock)" data-exp-jobs>
      <div className={styles.stack}>
        <Text variant="xl" as="h3">
          Job history
        </Text>
        <DataTable<JobRow>
          aria-label={latency ? 'Jobs (latency-sensitive)' : 'Jobs'}
          columns={jobColumns(latency)}
          rows={JOBS}
          rowKey={(j) => j.id}
          minWidth={1000}
          density="regular"
        />
      </div>
    </Card>
  );
}

/* ───────────────────────────── B5: list and queue ───────────────────────────── */

interface ListRow {
  id: string;
  name: string;
  description?: string;
  latency?: boolean;
  status: string;
  env: string;
}

const LIST: ListRow[] = [
  { id: 'e1', name: 'urgent check', status: 'RUNNING', env: 'staging' },
  { id: 'e2', name: 'timeout sweep', description: 'Timeout 10/30/60', latency: true, status: 'RUNNING', env: 'staging' },
  { id: 'e3', name: 'staging vs prod', latency: true, status: 'RUNNING', env: 'staging, production' },
  { id: 'e4', name: 'baseline latency under the new retriever configuration', description: 'Long name, the tag wraps', latency: true, status: 'COMPLETED', env: 'staging' },
];

function ListMock({ filtered }: { filtered?: boolean }) {
  const rows = filtered ? LIST.filter((r) => r.latency) : LIST;
  const columns: Column<ListRow>[] = [
    {
      id: 'name',
      header: 'Name',
      flex: true,
      minWidth: 220,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (x) => (
        <TwoLine
          primary={
            <span className={styles.jobTitle}>
              {x.name}
              {x.latency ? <LatencyTag /> : null}
            </span>
          }
          secondary={x.description}
        />
      ),
    },
    { id: 'status', header: 'Status', type: 'status', width: 120, priority: 1, cell: (x) => <ExperimentStatusBadge status={x.status} /> },
    { id: 'environments', header: 'Environments', width: 200, priority: 2, cell: (x) => x.env },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar} role="group" aria-label="Filter experiments">
        <Select label="Status" items={[{ key: 'all', label: 'All statuses' }]} value="all" onChange={noop} searchable={false} width={150} />
        <Checkbox isSelected={false} onChange={noop}>
          Created by me
        </Checkbox>
        <Checkbox isSelected={Boolean(filtered)} onChange={noop} data-testid="filter-latency">
          Latency-sensitive only
        </Checkbox>
      </div>
      <DataTable<ListRow> aria-label="Experiments" columns={columns} rows={rows} rowKey={(x) => x.id} minWidth={1000} density="regular" />
    </div>
  );
}

interface QueueRow {
  id: string;
  name: string;
  high?: boolean;
  latency?: boolean;
  env: string;
  status: string;
}

const QUEUE: QueueRow[] = [
  { id: 'q1', name: 'timeout sweep #2', latency: true, env: 'staging', status: 'RUNNING' },
  { id: 'q2', name: 'urgent check #0', high: true, env: 'staging', status: 'QUEUED' },
  { id: 'q3', name: 'staging vs prod #0', latency: true, env: 'production', status: 'QUEUED' },
];

function QueueMock() {
  const columns: Column<QueueRow>[] = [
    {
      id: 'job',
      header: 'Experiment',
      flex: true,
      minWidth: 200,
      priority: 1,
      cardTitle: true,
      cell: (j) => (
        <span className={styles.jobTitle}>
          <a className={styles.link} href="#queue-mock">
            {j.name}
          </a>
          {j.high ? <Tag tone="warning">HIGH</Tag> : null}
          {j.latency ? <LatencyTag /> : null}
        </span>
      ),
    },
    { id: 'env', header: 'Environment', width: 140, priority: 2, cell: (j) => j.env },
    { id: 'status', header: 'Status', type: 'status', width: 130, priority: 1, cell: (j) => <JobStatusBadge status={j.status} /> },
  ];
  return (
    <div className={styles.stack}>
      <Card className={styles.envCard} aria-label="staging">
        <div className={styles.sm}>
          <Text variant="lg" as="span">
            staging
          </Text>
          <p className={styles.note} data-testid="queue-latency-note">
            A latency-sensitive job is active on staging. Other jobs wait until it finishes.
          </p>
        </div>
      </Card>
      <DataTable<QueueRow> aria-label="Our jobs" columns={columns} rows={QUEUE} rowKey={(j) => j.id} minWidth={600} density="regular" />
    </div>
  );
}

/* ───────────────────────────── B5: environment edit form ───────────────────────────── */

export const MIN_ROLE_HELP =
  'Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.';

function EnvFormMock({ readOnly }: { readOnly?: boolean }) {
  return (
    <EnvSection id="env-policies" title="Policies" description="Limits applied to experiments launched on this environment.">
      <div className={envStyles.formGrid}>
        <Select label="Max priority" items={[{ key: 'HIGH', label: 'HIGH' }]} value="HIGH" onChange={noop} isDisabled={readOnly} searchable={false} />
        <Select label="Default priority" items={[{ key: 'NORMAL', label: 'NORMAL' }]} value="NORMAL" onChange={noop} isDisabled={readOnly} searchable={false} />
        <Select
          label="Who can launch latency-sensitive runs"
          items={[
            { key: 'member', label: 'Anyone in the project' },
            { key: 'manager', label: 'Project managers only' },
          ]}
          value={readOnly ? 'manager' : 'member'}
          onChange={noop}
          isDisabled={readOnly}
          searchable={false}
          help={MIN_ROLE_HELP}
        />
      </div>
    </EnvSection>
  );
}

/* ───────────────────────────── B4: Project settings, dataset read tokens ───────────────────────────── */

interface TokenRow {
  id: string;
  name: string;
  kind: 'admin' | 'experiment';
  experiment?: string;
  prefix: string;
  by: string;
  created: string;
  revoked?: boolean;
}

const TOKENS: TokenRow[] = [
  { id: 't1', name: 'Eval service', kind: 'admin', prefix: 'qym_dr_Zk3p…', by: 'dev@local', created: '3 days ago' },
  { id: 't2', name: 'Evaluation Service · timeout sweep', kind: 'experiment', experiment: 'timeout sweep', prefix: 'qym_dr_8Hq1…', by: 'dev@local', created: '5 min ago' },
  { id: 't3', name: 'Evaluation Service · baseline run', kind: 'experiment', experiment: 'baseline run', prefix: 'qym_dr_c0Vw…', by: 'dev@local', created: '2 days ago', revoked: true },
];

function TokensMock() {
  const columns: Column<TokenRow>[] = [
    {
      id: 'name',
      header: 'Name',
      flex: true,
      minWidth: 140,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (t) => (
        <TwoLine
          primary={
            <span className={styles.jobTitle}>
              {t.name}
              {t.kind === 'experiment' ? <Tag data-testid="token-kind-chip">experiment</Tag> : null}
            </span>
          }
          secondary={
            t.experiment ? (
              <a className={styles.link} href="#experiment-mock" data-testid="token-experiment-link">
                Experiment · {t.experiment}
              </a>
            ) : undefined
          }
        />
      ),
    },
    { id: 'prefix', header: 'Prefix', type: 'id', width: 140, priority: 3, cell: (t) => t.prefix },
    { id: 'creator', header: 'Created by', width: 180, priority: 2, cell: (t) => t.by },
    { id: 'created', header: 'Created', type: 'date', width: 130, priority: 2, cell: (t) => t.created },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 100,
      priority: 1,
      cell: (t) => (t.revoked ? <Badge tone="neutral">revoked</Badge> : <Badge tone="success">active</Badge>),
    },
  ];
  return (
    <Card
      as="section"
      aria-labelledby="ef-tokens-title"
      data-read-tokens
      header={
        <div>
          <Text variant="md" id="ef-tokens-title">
            Dataset read tokens
          </Text>
          <Text variant="sm">
            Admin-issued; lets a service read private test sets (QYM_DATASET_READ_TOKEN). Experiment tokens are issued
            at launch and revoked when the experiment settles.
          </Text>
        </div>
      }
    >
      <DataTable<TokenRow> aria-label="Dataset read tokens" columns={columns} rows={TOKENS} rowKey={(t) => t.id} density="regular" />
    </Card>
  );
}

/* ───────────────────────────── gallery wrapper ───────────────────────────── */

function L({ children }: { children: ReactNode }) {
  return (
    <p className={styles.label} data-kind="spec">
      {children}
    </p>
  );
}


export function EvalFlagsMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="eval-flags" title="Experiments: dataset read token and latency-sensitive runs (WP-B design contract)">
      <Case wide label="ef-run-settings (B5: the Latency-sensitive checkbox under Name and Priority; launch step 1)">
        <div className={styles.col}>
          <L>Off (default)</L>
          <RunSettingsMock mode="off" />
          <L>On, a project manager or an environment open to everyone</L>
          <RunSettingsMock mode="on" />
          <L>On, a member, one selected environment needs a manager</L>
          <RunSettingsMock mode="on-partial" />
          <L>Disabled, a member, every selected environment needs a manager</L>
          <RunSettingsMock mode="disabled-all" />
          <L>Archived project (read only)</L>
          <RunSettingsMock mode="readonly" />
        </div>
      </Case>
      <Case wide label="ef-review (B5, B4: the review pane row, the blocking item and the two dry-run warnings)">
        <div className={styles.aside}>
          <L>Ready, latency-sensitive</L>
          <ReviewMock mode="on" />
          <L>Blocking item (a member on a managers-only environment)</L>
          <ReviewMock mode="blocked" />
          <L>Dry-run warnings (ceiling unset, token not declared)</L>
          <ReviewMock mode="warnings" />
        </div>
      </Case>
      <Case wide label="ef-dataset (B4: restricted and private datasets in the launch picker; no launch gate)">
        <div className={styles.col}>
          <L>Restricted dataset selected</L>
          <DatasetMock selected="golden" />
          <L>Open list: chips at the inline end of the name</L>
          <DatasetMock selected="support-eval" open />
          <L>Plain dataset selected (no chip, no help)</L>
          <DatasetMock selected="intake-v2" />
        </div>
      </Case>
      <Case wide label="ef-detail-header (B4, B5: the Credentials row, the notice and the Latency-sensitive tag)">
        <div className={styles.report}>
          <L>Running, both credentials active, latency-sensitive</L>
          <HeaderMock latency api="active" token="active" />
          <L>Settled: both revoked</L>
          <HeaderMock status="COMPLETED" api="revoked" token="revoked" at="12:41" />
          <L>Launched before the feature: not issued</L>
          <HeaderMock api="active" token="none" />
          <L>Token revoked by hand while jobs are still live (jobs blocked until retried)</L>
          <HeaderMock api="active" token="revoked" at="12:41" notice={REVOKED_NOTICE} warn />
          <L>Token not sent to one environment (schema does not declare it)</L>
          <HeaderMock api="active" token="active" notice={ENV_NOTICE_ONE} />
          <L>Token not sent to any environment</L>
          <HeaderMock api="active" token="not-sent" notice={ENV_NOTICE_ALL} />
        </div>
      </Case>
      <Case wide label="ef-jobs (B5: the jobs table status cell, latency-sensitive experiment and an ordinary one)">
        <div className={styles.report}>
          <L>Latency-sensitive: status column 240 px, deferral and contamination text, requeue tag</L>
          <JobsMock latency />
          <L>Ordinary experiment: unchanged (status column 200 px)</L>
          <JobsMock latency={false} />
        </div>
      </Case>
      <Case wide label="ef-list-queue (B5: tag in the name cell, the filter, the queue tag and the environment note)">
        <div className={styles.report}>
          <L>Experiments list, all rows</L>
          <ListMock />
          <L>Experiments list, Latency-sensitive only</L>
          <ListMock filtered />
          <L>Queue</L>
          <QueueMock />
        </div>
      </Case>
      <Case wide label="ef-env-form (B5: Who can launch latency-sensitive runs, editable and read only)">
        <div className={styles.report}>
          <L>Manager or admin (editable)</L>
          <EnvFormMock />
          <L>Read only (a member sees the value, disabled)</L>
          <EnvFormMock readOnly />
        </div>
      </Case>
      <Case wide label="ef-tokens (B4: Project settings, API keys, Dataset read tokens with experiment tokens)">
        <div className={styles.report}>
          <TokensMock />
          <L>Revoke confirm, experiment token (dialog copy)</L>
          <div className={styles.dialogCopy} data-testid="token-revoke-copy">
            <Text variant="xl">Revoke “Evaluation Service · timeout sweep”?</Text>
            <Text variant="base" tone="secondary">
              Jobs of this experiment that have not read their dataset yet will fail until you retry them; the retry
              issues a new token.
            </Text>
            <div>
              <Button variant="danger" size="md" onPress={noop}>
                Revoke token
              </Button>
            </div>
          </div>
        </div>
      </Case>
    </Sec>
  );
}
