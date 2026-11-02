/**
 * QA-B mocks (design stage): static visual contracts for docs/internal/feature-rounds/2026-10-qa-feedback/spec-b.md.
 * Primitives, tokens and the real entry / runs-list CSS modules only; nothing here reads the API.
 * The CSS in QaExperimentsMocks.module.css is the proposed recipe (only what changes). Cases:
 * qb-home (QA3-a: latency control on the launch home view), qb-versions (QA2, QA4: the read-only block and its states),
 * qb-step1 (QA2, QA3, QA4: Customize step 1 without the versioning box, with the block below the environments),
 * qb-runs (QA3-d: the Runs page tag in the table and card layouts), qb-list (QA3-c: the Experiments list tag, kept).
 */
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Icon,
  IconButton,
  RunName,
  Select,
  Tag,
  Text,
  TextField,
  TwoLine,
} from '@/ui';
import { Callout } from '@/features/experiments/launch/components/Callout';
import panel from '@/features/experiments/launch/components/launch.module.css';
import entry from '@/features/experiments/launch/entry/entry.module.css';
import cells from '@/features/runs-list/cells.module.css';
import styles from './QaExperimentsMocks.module.css';

const noop = () => undefined;

export const LATENCY_HELPER =
  'Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.';
export const VERSIONS_HELP = 'Read from each environment. Runs record what its Evaluation Service reports.';

/** The one Latency-sensitive tag: sans, info tone, passive (list, detail, queue). */
function LatencyTag() {
  return (
    <Tag tone="info" data-testid="latency-tag">
      Latency-sensitive
    </Tag>
  );
}

/* ───────────────────────────── the shared latency control (one source: doc.latencySensitive) ───────────────────────────── */

export type LatencyMode = 'off' | 'on' | 'on-partial' | 'disabled-all' | 'readonly';

/** Checkbox, helper, gate reason and warning callout: the block RunSettings and the home view both render. */
function LatencyControl({ mode }: { mode: LatencyMode }) {
  const checked = mode === 'on' || mode === 'on-partial';
  const disabled = mode === 'disabled-all' || mode === 'readonly';
  return (
    <div className={entry.latency} data-testid="launch-latency">
      <Checkbox isSelected={checked} isDisabled={disabled} onChange={noop}>
        Latency-sensitive run
      </Checkbox>
      <p className={entry.checkHelp}>{LATENCY_HELPER}</p>
      {mode === 'disabled-all' ? (
        <p className={entry.checkReason} data-testid="launch-latency-reason">
          Only project managers can launch latency-sensitive runs on production.
        </p>
      ) : null}
      {checked ? (
        <Callout
          tone="warning"
          title="Other jobs wait while this run executes"
          className={entry.latencyCallout}
        >
          {mode === 'on-partial' ? (
            <span>
              Only a project manager can launch it on production. Clear the box or ask a project manager.
            </span>
          ) : null}
        </Callout>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── environment and dataset cards (real entry CSS) ───────────────────────────── */

function EnvRow({ name, preset, selected = true }: { name: string; preset?: boolean; selected?: boolean }) {
  return (
    <li className={entry.env} data-selected={selected}>
      <Checkbox isSelected={selected} onChange={noop}>
        {name}
      </Checkbox>
      <span className={entry.envTags}>
        <Tag tone="success">Healthy</Tag>
        <Tag>Priority up to HIGH</Tag>
        {preset ? <Tag kind="version">Default preset v1</Tag> : null}
      </span>
      <span className={entry.envActions}>
        <Button size="sm" variant="ghost" onPress={noop}>
          Details
        </Button>
      </span>
    </li>
  );
}

function EnvCard({ latency }: { latency?: LatencyMode }) {
  return (
    <Card>
      <div className={panel.cardStack}>
        <fieldset className={entry.fieldset}>
          <legend className={entry.legend}>Environments</legend>
          <ul className={entry.envList}>
            <EnvRow name="production" />
            <EnvRow name="staging" preset />
          </ul>
          <p className={entry.help}>
            Pick several to run the same configuration on each. Settings are the union of their forms.
          </p>
          <div>
            <Button size="sm" variant="neutral" onPress={noop}>
              New environment
            </Button>
          </div>
        </fieldset>
        {latency ? (
          <div className={styles.latencyBlock} data-testid="home-latency">
            <LatencyControl mode={latency} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function DatasetCard() {
  return (
    <Card>
      <div className={panel.cardStack}>
        <Select label="Dataset" items={[{ key: 'golden', label: 'golden' }]} value="golden" onChange={noop} />
        <Select
          label="Dataset version"
          items={[{ key: '', label: 'Latest version' }]}
          value=""
          onChange={noop}
        />
      </div>
    </Card>
  );
}

/* ───────────────────────────── the read-only versions block ───────────────────────────── */

export type VersionState =
  | { kind: 'ok'; details?: Record<string, string | null> }
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'error'; reason: string };

const OK: VersionState = {
  kind: 'ok',
  details: { agent: 'agent-1.4.2', image: 'img-20261001', kb: 'kb-77' },
};

function VersionRow({ env, state }: { env: string; state: VersionState }) {
  return (
    <div
      className={[entry.versionRow, styles.versionRow].join(' ')}
      data-env-version={env}
      data-status={state.kind}
    >
      <span className={entry.versionName}>{env}</span>
      {state.kind === 'loading' ? (
        <>
          {/* Outside the <dl>: a <dl> may only hold dt/dd groups (axe definition-list), as in VersionsBlock. */}
          <span className={styles.srOnly} role="status">
            Reading…
          </span>
          <dl className={entry.versionList} aria-busy="true">
            {['agent', 'image', 'kb'].map((key) => (
              <div key={key} className={entry.versionItem}>
                <dt>{key}</dt>
                <dd>
                  <span className={styles.skelValue} aria-hidden="true" />
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : state.kind === 'unsupported' ? (
        <span className={entry.help}>
          Not supported by this environment (its Evaluation Service is older than v1.2).
        </span>
      ) : state.kind === 'ok' ? (
        <dl className={entry.versionList}>
          {Object.entries(state.details ?? {}).map(([key, value]) => (
            <div key={key} className={entry.versionItem}>
              <dt>{key}</dt>
              {value == null ? (
                <dd data-unset="">not set</dd>
              ) : (
                <dd>
                  <Tag kind="version">{value}</Tag>
                </dd>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <span className={entry.errorText}>Couldn’t read: {state.reason}</span>
      )}
    </div>
  );
}

/** What the block shows (home view and Customize step 1 render the same component): no "Add versioning details" button. */
function VersionsBlockMock({ rows }: { rows: Array<[string, VersionState]> }) {
  return (
    <Card
      as="section"
      tone="meta"
      aria-label="Current versions"
      role="group"
      header={
        <div className={entry.versionsHead}>
          <Text variant="md" weight={600} as="span">
            Evaluation Service versions
          </Text>
          <span className={entry.help}>{VERSIONS_HELP}</span>
          <span className={entry.versionsActions}>
            <Button variant="ghost" onPress={noop}>
              Refresh
            </Button>
          </span>
        </div>
      }
    >
      <div className={entry.versionRows}>
        {rows.map(([env, state]) => (
          <VersionRow key={env} env={env} state={state} />
        ))}
      </div>
    </Card>
  );
}

/* ───────────────────────────── Customize step 1 ───────────────────────────── */

/** Name, priority and the latency control; the versioning box is gone (QA2). */
function RunSettingsMock({ mode }: { mode: LatencyMode }) {
  return (
    <Card as="section" aria-label="Name and priority">
      <div className={panel.cardStack}>
        <div className={entry.stack} data-testid="launch-run-settings">
          <div className={entry.row}>
            <TextField
              label="Experiment name"
              value="timeout sweep"
              onChange={noop}
              isDisabled={mode === 'readonly'}
            />
            <Select
              label="Priority"
              items={[{ key: '', label: 'Environment default (NORMAL)' }]}
              value=""
              onChange={noop}
              isDisabled={mode === 'readonly'}
            />
          </div>
          <LatencyControl mode={mode} />
        </div>
      </div>
    </Card>
  );
}

function Step1Mock({ mode, rows }: { mode: LatencyMode; rows: Array<[string, VersionState]> | null }) {
  return (
    <div className={entry.entry} data-testid="launch-entry-mock">
      <RunSettingsMock mode={mode} />
      <div className={entry.where}>
        <Card>
          <div className={panel.cardStack}>
            <fieldset className={entry.fieldset}>
              <legend className={entry.legend}>Environments</legend>
              <ul className={entry.envList}>
                <EnvRow name="production" selected={rows != null} />
                <EnvRow name="staging" preset selected={rows != null} />
              </ul>
              <p className={entry.help}>
                Pick several to run the same configuration on each. Settings are the union of their forms.
              </p>
            </fieldset>
          </div>
        </Card>
        <DatasetCard />
      </div>
      {rows ? <VersionsBlockMock rows={rows} /> : null}
    </div>
  );
}

/* ───────────────────────────── Runs page (QA3-d) ───────────────────────────── */

/** The compact tag: 20 x 20, info tone, the clock glyph. It takes the 24 px leading slot a run without passes leaves empty (a repeat run's chevron owns that slot, so there the tag follows Official). */
function RunLatencyTag() {
  return (
    <Tag
      tone="info"
      className={styles.runLatencyTag}
      role="img"
      aria-label="Latency-sensitive experiment"
      title="Latency-sensitive experiment"
      data-testid="run-latency-tag"
    >
      <Icon name="clock" size={12} />
    </Tag>
  );
}

function RunCellMock({
  name,
  official = true,
  latency,
  samples,
}: {
  name: string;
  official?: boolean;
  latency?: boolean;
  samples?: number;
}) {
  return (
    <span className={cells.runName} data-testid="run-cell">
      {samples ? (
        <IconButton
          label={`Expand ${samples} passes of ${name}`}
          icon="chevron-right"
          onPress={noop}
          className={cells.chevron}
        />
      ) : latency ? (
        <span className={styles.leadSlot}>
          <RunLatencyTag />
        </span>
      ) : (
        <span className={cells.chevronSpacer} aria-hidden="true" />
      )}
      <RunName to="#" name={name} />
      {samples ? <Tag kind="count">×{samples}</Tag> : null}
      {official ? (
        <Tag kind="accent" title="Run launched by an official experiment">
          Official
        </Tag>
      ) : null}
      {latency && samples ? <RunLatencyTag /> : null}
    </span>
  );
}

function RunsFrame({ children, kind }: { children: ReactNode; kind: 'cell' | 'card' }) {
  return (
    <div className={kind === 'cell' ? styles.runsCell : styles.runsCard} data-testid={`runs-${kind}-frame`}>
      {children}
    </div>
  );
}

/* ───────────────────────────── Experiments list (QA3-c, kept) ───────────────────────────── */

function ListNameCell({
  name,
  description,
  latency,
}: {
  name: string;
  description?: string;
  latency?: boolean;
}) {
  return (
    <div className={styles.listCell}>
      <TwoLine
        primary={
          <span className={styles.nameLine}>
            {name}
            {latency ? <LatencyTag /> : null}
          </span>
        }
        secondary={description}
      />
    </div>
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

const MIXED: Array<[string, VersionState]> = [
  ['production', OK],
  ['qa-lab', { kind: 'unsupported' }],
  ['staging', { kind: 'error', reason: 'Evaluation service could not read its versions (KB offline)' }],
];

export function QaExperimentsMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec
      id="qa-experiments"
      title="Experiments QA round: versions read-only and the latency flag (QA-B design contract)"
    >
      <Case
        wide
        label="qb-home (QA3-a: the latency control on the launch home view, inside the Environments card)"
      >
        <div className={styles.home}>
          <L>Off (default)</L>
          <div className={entry.where}>
            <EnvCard latency="off" />
            <DatasetCard />
          </div>
          <L>On (a manager, or every selected environment open to members)</L>
          <div className={entry.where}>
            <EnvCard latency="on" />
            <DatasetCard />
          </div>
          <L>On, a member, one selected environment needs a manager</L>
          <div className={entry.where}>
            <EnvCard latency="on-partial" />
            <DatasetCard />
          </div>
          <L>Disabled, a member, every selected environment needs a manager</L>
          <div className={entry.where}>
            <EnvCard latency="disabled-all" />
            <DatasetCard />
          </div>
          <L>Archived project (read only)</L>
          <div className={entry.where}>
            <EnvCard latency="readonly" />
            <DatasetCard />
          </div>
        </div>
      </Case>
      <Case
        wide
        label="qb-versions (QA2, QA4: the read-only block; every state; same component on the home view and step 1)"
      >
        <div className={styles.col}>
          <L>Loaded, two environments</L>
          <VersionsBlockMock
            rows={[
              ['production', OK],
              ['staging', OK],
            ]}
          />
          <L>Loading (same row height as loaded)</L>
          <VersionsBlockMock
            rows={[
              ['production', { kind: 'loading' }],
              ['staging', { kind: 'loading' }],
            ]}
          />
          <L>Mixed: loaded, older service, read error</L>
          <VersionsBlockMock rows={MIXED} />
          <L>A key the service leaves unset</L>
          <VersionsBlockMock
            rows={[['staging', { kind: 'ok', details: { agent: 'agent-1.4.2', image: null, kb: 'kb-77' } }]]}
          />
        </div>
      </Case>
      <Case
        wide
        label="qb-step1 (QA2, QA3, QA4: Customize step 1; no versioning box; the block below the environments)"
      >
        <div className={styles.col}>
          <L>No environment selected: no block</L>
          <Step1Mock mode="off" rows={null} />
          <L>Two environments, loaded, latency on</L>
          <Step1Mock
            mode="on"
            rows={[
              ['production', OK],
              ['staging', OK],
            ]}
          />
          <L>Loading</L>
          <Step1Mock
            mode="off"
            rows={[
              ['production', { kind: 'loading' }],
              ['staging', { kind: 'loading' }],
            ]}
          />
          <L>Mixed states, latency disabled for a member</L>
          <Step1Mock mode="disabled-all" rows={MIXED} />
          <L>Archived project (read only; the block still reads)</L>
          <Step1Mock mode="readonly" rows={[['staging', OK]]} />
        </div>
      </Case>
      <Case wide label="qb-runs (QA3-d: the Runs page tag; table cell 260 px, card head 273 px)">
        <div className={styles.stack}>
          <L>
            Table, Run cell (260 px column): official, latency-sensitive in the leading slot, long name,
            repeat run (tag after Official)
          </L>
          <RunsFrame kind="cell">
            <RunCellMock name="prompt sweep · timeout=10" />
          </RunsFrame>
          <RunsFrame kind="cell">
            <RunCellMock name="prompt sweep · timeout=10" latency />
          </RunsFrame>
          <RunsFrame kind="cell">
            <RunCellMock name="staging vs prod · production" latency />
          </RunsFrame>
          <RunsFrame kind="cell">
            <RunCellMock name="latency check" latency samples={3} />
          </RunsFrame>
          <L>Card layout under 640 px (card head 273 px)</L>
          <RunsFrame kind="card">
            <RunCellMock name="staging vs prod · production" latency />
          </RunsFrame>
          <RunsFrame kind="card">
            <RunCellMock name="local smoke" official={false} />
          </RunsFrame>
        </div>
      </Case>
      <Case wide label="qb-list (QA3-c: the Experiments list name cell, unchanged; 220 px column)">
        <div className={styles.stack}>
          <L>Short name: tag on the first line</L>
          <ListNameCell name="latency check" description="Timeout 10/30" latency />
          <L>Long name: the tag wraps under it, never clipped</L>
          <ListNameCell
            name="nightly regression of the support agent on staging"
            description="Timeout 10/30"
            latency
          />
          <L>Not latency-sensitive: same row height</L>
          <ListNameCell name="nightly baseline" description="Timeout 10/30" />
        </div>
      </Case>
    </Sec>
  );
}
