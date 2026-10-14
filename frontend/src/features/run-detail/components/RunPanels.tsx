/** Review history, experiment panel, versioning details and lock notices (brief 04 §3a). */
import { useState } from 'react';
import { projectPath } from '@/app/routes';
import { useReviewHistoryQuery } from '@/api/runs';
import { Badge, JsonPreview, LinkButton, Tag, Card } from '@/ui';
import { formatIsoDateTime, READ_ONLY_COPY, SCORE_LOCK_COPY } from '../lib/heroModel';
import type { ReviewHistoryEvent, Run } from '../types';
import styles from './RunPanels.module.css';

const ACTIONS: Record<string, { label: string; tone?: 'success' | 'danger' | 'warning' }> = {
  submit: { label: 'Submitted' },
  approve: { label: 'Approved', tone: 'success' },
  reject: { label: 'Rejected', tone: 'danger' },
  unapprove: { label: 'Approval withdrawn', tone: 'warning' },
  unreject: { label: 'Rejection withdrawn', tone: 'warning' },
};

function who(u: { display_name?: string; email?: string; id?: string } | null | undefined): string {
  return u ? u.display_name || u.email || u.id || 'Unknown user' : 'Unknown user';
}

function HistoryEntry({ event }: { event: ReviewHistoryEvent }) {
  const action = ACTIONS[event.action] ?? { label: String(event.action || 'Changed') };
  return (
    <li className={styles.entry} data-action={event.action}>
      <div className={styles.entryHead}>
        <Tag tone={action.tone}>{action.label}</Tag>
        <span className={styles.actor}>{who(event.actor)}</span>
        {event.on_behalf_of ? <span>on behalf of {who(event.on_behalf_of)}</span> : null}
        {event.to_status && (event.action === 'unapprove' || event.action === 'unreject') ? (
          <span>returned the run to {String(event.to_status).toLowerCase()}</span>
        ) : null}
        {event.at ? (
          <time className={styles.when} dateTime={event.at}>
            {formatIsoDateTime(event.at)}
          </time>
        ) : null}
      </div>
      {event.comment ? <div className={styles.comment}>“{event.comment}”</div> : null}
      {event.recorded === false ? (
        <div className={styles.note}>
          Reconstructed from the approval record; earlier changes were not kept.
        </div>
      ) : null}
    </li>
  );
}

/** Hidden when the run was never submitted (no events) or the request failed. */
export function ReviewHistory({ runId, status }: { runId: string; status: string }) {
  const { data } = useReviewHistoryQuery(runId, true);
  const events = data?.events ?? [];
  void status;
  if (!events.length) return null;
  return (
    <Card as="section" aria-label="Review history" data-testid="review-history">
      <div className={styles.title}>Review history</div>
      <div className={styles.copy}>Every submission and review decision on this run, oldest first.</div>
      <ol className={styles.list}>
        {events.map((event, i) => (
          <HistoryEntry key={i} event={event} />
        ))}
      </ol>
    </Card>
  );
}

export function VersioningDetails({ run }: { run: Run }) {
  const entries = Object.entries(run.versioning_details ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  return (
    <Card as="section" aria-label="Versioning details" data-testid="versioning-details">
      <div className={styles.title}>Versioning details</div>
      <div className={styles.copy}>
        Keys set by whoever created this run, or by the experiment that launched it.
      </div>
      <dl className={styles.kv}>
        {entries.map(([key, value]) => (
          <div className={styles.kvRow} key={key}>
            <dt className={styles.kvKey}>{key}</dt>
            <dd className={styles.kvVal}>
              {value !== null && typeof value === 'object' ? (
                <JsonPreview value={value} title={key} compact />
              ) : (
                String(value ?? '—')
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const BASE_LABELS: Record<string, string> = {
  official: 'Default preset',
  saved: 'Saved preset',
  best_run: 'Best run',
  blank: 'Blank',
  clone: 'Clone',
};
const JOB_TONES: Record<string, 'success' | 'info' | 'danger' | 'warning' | 'neutral'> = {
  SUCCEEDED: 'success',
  COMPLETED: 'success',
  RUNNING: 'info',
  SUBMITTED: 'info',
  SUBMITTING: 'info',
  QUEUED: 'neutral',
  FAILED: 'danger',
  TIMED_OUT: 'danger',
  CANCELLED: 'warning',
  CANCELLING: 'warning',
  BLOCKED: 'warning',
  PARTIAL: 'warning',
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function display(value: unknown): string {
  if (value == null) return '—';
  if (isObj(value)) {
    if (value.name) return value.model ? `${value.name} (${value.model})` : String(value.name);
    if (isObj(value.temporary)) {
      const t = value.temporary;
      return `${t.label ?? 'Temporary model'}${t.model ? ` (${t.model})` : ''}`;
    }
    return JSON.stringify(value);
  }
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function pointerLabel(pointer: string): string {
  return pointer.split('/').filter(Boolean).slice(-2).join('.') || pointer;
}

const PROMOTABLE = ['COMPLETED', 'SUBMITTED', 'APPROVED'];

/** Official runs only (run.experiment non-null with origin official). */
export function ExperimentPanel({ run, slug }: { run: Run; slug: string }) {
  const [open, setOpen] = useState(false);
  const panel = run.experiment?.panel as Record<string, unknown> | undefined;
  const exp = run.experiment as Record<string, unknown> | null | undefined;
  const p =
    (isObj(exp) && exp.origin === 'official' ? exp : null) ??
    (isObj(panel) && panel.origin === 'official' ? panel : null);
  if (!p) return null;
  const experimentId = p.experiment_id ? String(p.experiment_id) : '';
  const available = !!p.experiment_available && !!experimentId;
  const experimentHref = available
    ? `${projectPath(slug, 'experiments')}?experiment=${encodeURIComponent(experimentId)}`
    : null;
  const rerunParams = new URLSearchParams({ new: '1', clone: experimentId });
  if (p.job_available && p.job_id) rerunParams.set('job', String(p.job_id));
  const rerunHref = available ? `${projectPath(slug, 'experiments')}?${rerunParams.toString()}` : null;
  const promoteHref =
    p.can_promote && p.environment_id
      ? `${projectPath(slug, 'settings')}?${new URLSearchParams({ tab: 'environments', env: String(p.environment_id), promote: 'run', id: run.run_id }).toString()}`
      : null;
  const promotable = PROMOTABLE.includes(String(run.status).toUpperCase());
  const sweep = Object.entries(isObj(p.sweep) ? p.sweep : {}).map(([k, v]): [string, string, string] => [
    pointerLabel(k),
    display(v),
    k,
  ]);
  const models = Object.entries(isObj(p.slot_bindings) ? p.slot_bindings : {})
    .filter(([, v]) => v != null)
    .map(([k, v]): [string, string, string] => [k.replace(/^[^:]*:/, ''), display(v), k]);
  const versions = isObj(p.remote_versioning)
    ? Object.entries(p.remote_versioning).map(([k, v]): [string, string, string] => [k, display(v), k])
    : [];
  const base = isObj(p.base_source) && p.base_source.kind ? p.base_source : null;
  const ref = base
    ? String(base.preset_version_id ?? base.preset_id ?? base.run_id ?? base.experiment_id ?? '')
    : '';
  const combo =
    p.combo_index != null
      ? `#${Number(p.combo_index) + 1}${Number(p.attempt) > 0 ? ` · retry ${Number(p.attempt)}` : ''}`
      : '—';
  const jobStatus = p.job_status ? String(p.job_status).toUpperCase() : '';
  const tags = (rows: Array<[string, string, string]>, kind: 'version' | 'data') =>
    rows.length ? (
      <span className={styles.tags}>
        {rows.map(([k, v, title]) => (
          <Tag key={title} kind={kind} title={title}>
            {k} <b>{v}</b>
          </Tag>
        ))}
      </span>
    ) : (
      '—'
    );
  const fields: Array<[string, React.ReactNode, boolean?]> = [
    [
      'Experiment',
      experimentHref ? (
        <a href={experimentHref}>{String(p.experiment_name ?? experimentId.slice(0, 8))}</a>
      ) : (
        String(p.experiment_name ?? (experimentId.slice(0, 8) || '—'))
      ),
    ],
    [
      'Environment',
      String(p.environment_name ?? (p.environment_id ? String(p.environment_id).slice(0, 8) : '—')),
    ],
    ['Combination', combo],
    [
      'Base source',
      base
        ? `${BASE_LABELS[String(base.kind)] ?? String(base.kind)}${ref ? ` ${ref.slice(0, 8)}` : ''}`
        : '—',
    ],
    ['Remote job id', String(p.remote_job_id ?? '—')],
    [
      'Job status',
      jobStatus ? (
        <Badge tone={JOB_TONES[jobStatus] ?? 'neutral'}>{jobStatus.replace(/_/g, ' ')}</Badge>
      ) : (
        '—'
      ),
    ],
    ['Schema hash', p.schema_hash ? String(p.schema_hash).slice(0, 12) : '—'],
    ['Versioning', tags(versions, 'version'), true],
    ['Swept params', tags(sweep, 'data'), true],
    ['Models', tags(models, 'data'), true],
  ];
  if (p.error) fields.push(['Job error', String(p.error), true]);
  return (
    <Card as="section" aria-labelledby="rxp-title" data-testid="experiment-panel">
      <div className={styles.expHead}>
        <div>
          <div className={styles.titleRow}>
            <h2 className={styles.title} id="rxp-title">
              Experiment
            </h2>
            <Tag kind="accent">Official run</Tag>
          </div>
          <div className={styles.copy}>
            Launched by qym on a registered environment. Settings show this run’s combination.
          </div>
        </div>
        <div className={styles.actions}>
          {experimentHref ? (
            <LinkButton to={experimentHref} variant="neutral" size="sm">
              Open experiment
            </LinkButton>
          ) : null}
          {rerunHref ? (
            <LinkButton
              to={rerunHref}
              variant="accent"
              size="sm"
              title="Open the launch form prefilled with this run’s configuration"
            >
              Rerun with this config
            </LinkButton>
          ) : (
            <span className={styles.disabledHint} title="The experiment no longer exists">
              Rerun unavailable
            </span>
          )}
          {promoteHref && promotable ? (
            <LinkButton to={promoteHref} variant="neutral" size="sm">
              Promote to default preset
            </LinkButton>
          ) : null}
        </div>
      </div>
      {!p.job_available ? (
        <p className={styles.note}>
          The launch job is no longer available; showing the configuration stored on the run.
        </p>
      ) : null}
      <dl className={styles.expGrid}>
        {fields.map(([label, value, wide]) => (
          <div key={label} className={wide ? styles.wide : undefined}>
            <dt className={styles.kvKey}>{label}</dt>
            <dd className={styles.expVal}>{value}</dd>
          </div>
        ))}
      </dl>
      {p.remote_result != null ? (
        <details className={styles.result} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>Service result</summary>
          <pre className={styles.json}>{JSON.stringify(p.remote_result, null, 2)}</pre>
        </details>
      ) : null}
    </Card>
  );
}

export function RunNotices({ run, readOnly }: { run: Run; readOnly: boolean }) {
  const lock = SCORE_LOCK_COPY[String(run.status).toUpperCase()];
  return (
    <>
      {readOnly ? (
        <div className={styles.notice} role="note" data-testid="read-only-notice">
          <b>{READ_ONLY_COPY.lead}</b> {READ_ONLY_COPY.body}
        </div>
      ) : lock ? (
        <div className={styles.notice} role="note" data-testid="scores-locked-notice">
          <b>{lock.lead}</b> {lock.body}
        </div>
      ) : null}
    </>
  );
}
