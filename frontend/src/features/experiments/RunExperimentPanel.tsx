/**
 * Run-page "Experiment" panel (brief 06 §2.11). Exported for the run-detail area; this
 * area registers nothing on its routes. Official runs only: pass `run.experiment` (the
 * run detail API's panel object) and the run's id/status.
 *
 *   <RunExperimentPanel panel={run.experiment} slug={slug} runId={run.run_id} runStatus={run.status} />
 */
import { Link } from 'react-router-dom';
import { LinkButton, KeyValueGrid, Tag, Text, JsonTree, type KeyValueItem } from '@/ui';
import { JobStatusBadge } from './components/StatusBadges';
import { defaultPresetEditPath, experimentPath, launchPath } from './paths';
import styles from './RunExperimentPanel.module.css';

export interface RunExperimentPanelData {
  origin?: string;
  experiment_id?: string | null;
  experiment_name?: string | null;
  experiment_available?: boolean;
  environment_id?: string | null;
  environment_name?: string | null;
  combo_index?: number | null;
  attempt?: number | null;
  base_source?: {
    kind?: string;
    preset_version_id?: string;
    preset_id?: string;
    run_id?: string;
    experiment_id?: string;
  } | null;
  remote_job_id?: string | null;
  job_id?: string | null;
  job_available?: boolean;
  job_status?: string | null;
  schema_hash?: string | null;
  remote_versioning?: Record<string, unknown> | null;
  sweep?: Record<string, unknown> | null;
  slot_bindings?: Record<string, unknown> | null;
  error?: string | null;
  remote_result?: unknown;
  can_promote?: boolean;
}

export interface RunExperimentPanelProps {
  panel: RunExperimentPanelData | null | undefined;
  slug: string;
  runId: string;
  runStatus?: string;
  /** Static export (no actions). */
  isExport?: boolean;
}

const BASE_LABELS: Record<string, string> = {
  official: 'Default preset',
  saved: 'Saved preset',
  best_run: 'Best run',
  blank: 'Blank',
  clone: 'Clone',
};
const PROMOTABLE = ['COMPLETED', 'SUBMITTED', 'APPROVED'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Short human text of a binding / versioning value. */
export function displayValue(value: unknown): string {
  if (value == null) return '—';
  if (isObject(value)) {
    if (value.name)
      return value.model ? `${String(value.name)} (${String(value.model)})` : String(value.name);
    const t = value.temporary;
    if (isObject(t))
      return `${String(t.label || 'Temporary model')}${t.model ? ` (${String(t.model)})` : ''}`;
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export function pointerLabel(pointer: string): string {
  return pointer.split('/').filter(Boolean).slice(-2).join('.') || pointer;
}

function TagList({ entries, kind }: { entries: [string, string, string][]; kind: 'data' | 'version' }) {
  if (!entries.length) return <>—</>;
  return (
    <span className={styles.tags}>
      {entries.map(([k, v, title]) => (
        <Tag key={title} kind={kind} title={title}>
          {k} <span className={styles.tagValue}>{v}</span>
        </Tag>
      ))}
    </span>
  );
}

export function RunExperimentPanel({ panel, slug, runId, runStatus, isExport }: RunExperimentPanelProps) {
  if (!panel || panel.origin !== 'official') return null;
  const openable = Boolean(panel.experiment_available && panel.experiment_id);
  const rerunQuery: Record<string, string | undefined> = { clone: panel.experiment_id ?? undefined };
  if (panel.job_available && panel.job_id) rerunQuery.job = panel.job_id;
  const promotable = PROMOTABLE.includes(String(runStatus ?? '').toUpperCase());
  const showPromote = Boolean(panel.can_promote && panel.environment_id);
  const base = panel.base_source;
  const baseRef = base?.preset_version_id || base?.preset_id || base?.run_id || base?.experiment_id || '';
  const items: (KeyValueItem & { wide?: boolean })[] = [
    {
      key: 'experiment',
      label: 'Experiment',
      value:
        openable && !isExport ? (
          <Link to={experimentPath(slug, panel.experiment_id ?? '')} className={styles.link}>
            {panel.experiment_name || String(panel.experiment_id).slice(0, 8)}
          </Link>
        ) : (
          panel.experiment_name || (panel.experiment_id ? String(panel.experiment_id).slice(0, 8) : '—')
        ),
    },
    {
      key: 'env',
      label: 'Environment',
      value:
        panel.environment_name || (panel.environment_id ? String(panel.environment_id).slice(0, 8) : '—'),
    },
    {
      key: 'combo',
      label: 'Combination',
      mono: true,
      value:
        panel.combo_index != null
          ? `#${Number(panel.combo_index) + 1}${Number(panel.attempt) > 0 ? ` · retry ${Number(panel.attempt)}` : ''}`
          : '—',
    },
    {
      key: 'base',
      label: 'Base source',
      value: base?.kind ? (
        <>
          {BASE_LABELS[base.kind] ?? base.kind}
          {baseRef ? (
            <span className={styles.mono} title={baseRef}>
              {' '}
              {baseRef.slice(0, 8)}
            </span>
          ) : null}
        </>
      ) : (
        '—'
      ),
    },
    { key: 'remote', label: 'Remote job id', mono: true, value: panel.remote_job_id || '—' },
    {
      key: 'status',
      label: 'Job status',
      value: panel.job_status ? <JobStatusBadge status={panel.job_status} /> : '—',
    },
    {
      key: 'schema',
      label: 'Schema hash',
      mono: true,
      value: panel.schema_hash ? panel.schema_hash.slice(0, 12) : '—',
    },
    {
      key: 'versioning',
      label: 'Versioning',
      value: (
        <TagList
          kind="version"
          entries={
            isObject(panel.remote_versioning)
              ? Object.entries(panel.remote_versioning).map(([k, v]) => [k, displayValue(v), k])
              : []
          }
        />
      ),
    },
    {
      key: 'sweep',
      label: 'Swept params',
      value: (
        <TagList
          kind="data"
          entries={Object.entries(panel.sweep ?? {}).map(([p, v]) => [pointerLabel(p), displayValue(v), p])}
        />
      ),
    },
    {
      key: 'models',
      label: 'Models',
      value: (
        <TagList
          kind="data"
          entries={Object.entries(panel.slot_bindings ?? {})
            .filter(([, v]) => v != null)
            .map(([slot, v]) => [slot.replace(/^[^:]*:/, ''), displayValue(v), slot])}
        />
      ),
    },
  ];
  if (panel.error)
    items.push({
      key: 'error',
      label: 'Job error',
      value: <span className={styles.error}>{panel.error}</span>,
    });

  return (
    <section className={styles.panel} aria-labelledby="run-experiment-title" data-run-experiment-panel>
      <div className={styles.head}>
        <div>
          <div className={styles.titleRow}>
            <h3 id="run-experiment-title" className={styles.title}>
              Experiment
            </h3>
            <Tag kind="accent">Official run</Tag>
          </div>
          <Text variant="sm" tone="secondary">
            Launched by qym on a registered environment. Settings show this run’s combination.
          </Text>
        </div>
        {!isExport ? (
          <div className={styles.actions}>
            {openable ? (
              <LinkButton to={experimentPath(slug, panel.experiment_id ?? '')} variant="neutral">
                Open experiment
              </LinkButton>
            ) : null}
            {openable ? (
              <LinkButton
                to={launchPath(slug, rerunQuery)}
                variant="accent"
                title="Open the launch form prefilled with this run’s configuration"
              >
                Rerun with this config
              </LinkButton>
            ) : (
              <span className={styles.disabled} title="The experiment no longer exists" aria-disabled="true">
                Rerun with this config
              </span>
            )}
            {showPromote ? (
              promotable ? (
                <LinkButton
                  to={defaultPresetEditPath(slug, panel.environment_id ?? '', { promote: 'run', id: runId })}
                  variant="neutral"
                  title="Open the default preset editor with this run’s configuration; nothing is published until you publish"
                >
                  Promote to default preset
                </LinkButton>
              ) : (
                <span
                  className={styles.disabled}
                  title="Only completed runs can be promoted"
                  aria-disabled="true"
                >
                  Promote to default preset
                </span>
              )
            ) : null}
          </div>
        ) : null}
      </div>
      {!panel.job_available ? (
        <p className={styles.note}>
          The launch job is no longer available; showing the configuration stored on the run.
        </p>
      ) : null}
      <KeyValueGrid items={items} columns={2} aria-label="Experiment details" />
      {panel.remote_result != null ? (
        <details className={styles.result}>
          <summary>Service result</summary>
          <JsonTree data={panel.remote_result} label="Service result" />
        </details>
      ) : null}
    </section>
  );
}
