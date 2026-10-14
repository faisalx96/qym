/**
 * Run hero: one primary strip that is always visible (name, status, actions, then task / dataset / model tags with the
 * start time and runtime) and, behind the chevron, the secondary details (owner, project, version, execution
 * context, versioning details). The strip is about the legacy header's height; the report starts on the first screen.
 */
import { Link } from 'react-router-dom';
import { exportHtmlUrl } from '@/api/runs';
import { platformUrl } from '@/lib/runtime';
import {
  Card,
  DatasetTag,
  Icon,
  IconButton,
  isBareRunId,
  JsonPreview,
  KeyValueGrid,
  LinkButton,
  ModelTag,
  RunStatusBadge,
  Tag,
  TaskTag,
  Text,
  runStatusTone,
  type CardTone,
} from '@/ui';
import type { LiveRunState } from '../hooks/useLiveRun';
import { useTicker } from '../hooks/useLiveRun';
import {
  executionContextEntries,
  formatDurationMs,
  formatIsoDateTime,
  heroTiming,
  ingestWarning,
  isLiveStatus,
  runEntityLinks,
} from '../lib/heroModel';
import type { RunModel } from '../lib/runModel';
import type { PassSummary, Run } from '../types';
import { RunPager } from './RunPager';
import styles from './RunHero.module.css';

export interface RunHeroProps {
  run: Run;
  model: RunModel;
  live: LiveRunState;
  passSummary: PassSummary | null;
  slug: string;
  listParam: string | null;
  /** Path of this run without the query, for the "all passes" link. */
  basePath: string;
  /** Secondary details (owner, project, version, execution context, versioning) shown; the chevron toggles it. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Extra hero content under the execution context (versioning details). */
  extra?: React.ReactNode;
}

function Meta({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  if (children == null || children === '') return null;
  return (
    <div className={styles.metaItem}>
      <dt className={styles.metaLabel}>{label}</dt>
      <dd className={styles.metaValue} title={title}>
        {children}
      </dd>
    </div>
  );
}

function MetaLink({ to, title, children }: { to: string | null; title?: string; children: React.ReactNode }) {
  return to ? (
    <Link className={styles.metaLink} to={to} title={title}>
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

export function LiveIndicator({ live, run }: { live: LiveRunState; run: Run }) {
  const now = useTicker(live.live);
  if (!live.live || !isLiveStatus(run.status)) return null;
  const secs = live.updatedAt ? Math.max(0, Math.round((now - live.updatedAt) / 1000)) : 0;
  return (
    <span className={styles.live} data-testid="live-indicator">
      Live · updated {secs}s ago
    </span>
  );
}

export function RunHero({
  run,
  model,
  live,
  passSummary,
  slug,
  listParam,
  basePath,
  expanded,
  onToggleExpanded,
  extra,
}: RunHeroProps) {
  const samples = model.samples;
  const viewPass = model.viewPass;
  const pass = viewPass ? passSummary : null;
  const liveNow = live.live && isLiveStatus(run.status);
  const stopping = !pass && (live.stopRequested || !!run.stop_requested) && liveNow;
  const scopedStatus = pass?.status ?? run.status ?? 'unknown';
  const statusText = stopping ? 'STOPPING…' : String(scopedStatus).toUpperCase();
  const statusKey = stopping ? 'STOPPED' : String(scopedStatus).toUpperCase();
  const now = useTicker(liveNow);
  const timing = heroTiming(
    { ...run, status: liveNow ? 'RUNNING' : run.status },
    pass,
    now + live.serverOffsetMs,
  );
  const runtimeMs = timing.runtimeMs;
  const modelName = run.model_name ?? (run.config?.model as string | undefined) ?? '';
  const links = runEntityLinks(run, slug);
  const warning = ingestWarning(run);
  const context = executionContextEntries(run);
  const version = [run.git_branch, run.git_commit].filter(Boolean).join(' • ');
  const runningPass =
    !viewPass && samples > 1 && liveNow
      ? ` • pass ${Math.min((run.last_completed_pass ?? 0) + 1, samples)}/${samples}`
      : '';
  const ownerLabel = run.owner?.display_name || run.owner?.email || run.owner?.id || '';
  const projectName = run.project?.name ?? '';

  return (
    <Card
      as="section"
      aria-label="Run summary"
      className={styles.hero}
      tone={
        (runStatusTone(statusKey) as CardTone) === 'neutral'
          ? undefined
          : (runStatusTone(statusKey) as CardTone)
      }
      data-testid="run-hero"
    >
      <div className={styles.heroBody}>
        <div className={styles.top}>
          <div className={styles.identity}>
            <div className={styles.headline}>
              <h1
                className={styles.name}
                data-id={isBareRunId(run.run_name || run.run_id, run.run_id) ? '' : undefined}
                title={run.run_name || run.run_id}
              >
                {run.run_name || run.run_id}
              </h1>
              {viewPass ? (
                <Link
                  className={styles.passPill}
                  to={basePath}
                  title={`Viewing pass ${viewPass} of ${samples}. Return to all passes.`}
                >
                  Pass {viewPass}/{samples}
                </Link>
              ) : samples === 1 && model.isRepeat ? (
                <Link
                  className={styles.passPill}
                  to={`${basePath}?pass=1`}
                  title="View the remaining pass and its reviews"
                >
                  Pass 1
                </Link>
              ) : samples > 1 ? (
                <Tag kind="count" title={`${samples} passes per item`}>
                  x{samples} passes
                </Tag>
              ) : null}
            </div>
          </div>
          <div className={styles.right}>
            <span title={!viewPass && run.status_reason_label ? run.status_reason_label : undefined}>
              <RunStatusBadge status={statusKey} label={statusText + runningPass} />
            </span>
            <LiveIndicator live={live} run={run} />
            {liveNow && runtimeMs != null ? (
              <span className={styles.live} data-testid="hero-runtime-live">
                Runtime <span className={styles.mono}>{formatDurationMs(runtimeMs)}</span>
              </span>
            ) : null}
            <LinkButton
              variant="accent"
              size="sm"
              href={platformUrl(exportHtmlUrl(run.run_id))}
              target="_blank"
              rel="noopener noreferrer"
              icon={<Icon name="external" size={14} />}
              title="Download this run as a standalone HTML file (opens the classic export)"
            >
              Export HTML
            </LinkButton>
            <RunPager runId={run.run_id} slug={slug} listParam={listParam} />
            <IconButton
              label={expanded ? 'Hide run details' : 'Show run details'}
              icon={expanded ? 'chevron-up' : 'chevron-down'}
              aria-expanded={expanded}
              aria-controls="run-hero-details"
              onPress={onToggleExpanded}
            />
          </div>
        </div>

        <div className={styles.strip} data-testid="run-hero-strip">
          <MetaLink to={links.task} title={`Runs of task ${run.task_name}`}>
            <TaskTag name={run.task_name} />
          </MetaLink>
          <MetaLink to={links.dataset} title={links.datasetTitle}>
            <DatasetTag
              name={run.dataset_name}
              version={run.dataset_version}
              aliases={run.dataset_aliases}
            />
          </MetaLink>
          {modelName ? (
            <MetaLink to={links.model} title={`Runs of model ${modelName}`}>
              <ModelTag
                name={modelName}
                title={modelName}
                reasoning={!!(pass ? pass.trace_stats : run.trace_stats)?.has_reasoning}
              />
            </MetaLink>
          ) : null}
          <span className={styles.facts}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Started</span> {formatIsoDateTime(timing.startedAt)}
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Runtime</span>{' '}
              <span data-testid="hero-runtime" className={styles.mono}>
                {runtimeMs != null ? formatDurationMs(runtimeMs) : '—'}
              </span>
            </span>
          </span>
        </div>

        {warning ? (
          <div className={styles.banner} role="status" data-testid="ingest-warning">
            <Icon name="warning" size={16} />
            <div>
              <div className={styles.bannerTitle}>Incomplete data</div>
              {warning.missing > 0 ? (
                <p className={styles.bannerBody}>
                  The evaluation reported <b>{warning.expected}</b> items, but only <b>{warning.received}</b>{' '}
                  reached the platform (<b>{warning.missing}</b> missing). The rows and metrics below cover
                  the received items only — check the eval client’s upload warnings for the rest.
                </p>
              ) : null}
              {warning.rejectedCount > 0 ? (
                <div className={styles.bannerBody} data-ingest-rejected={warning.rejectedCount}>
                  The platform rejected <b>{warning.rejectedCount}</b>{' '}
                  {warning.rejectedCount === 1 ? 'event' : 'events'} from this run, so the data{' '}
                  {warning.rejectedCount === 1 ? 'it' : 'they'} carried is missing below
                  {warning.rejected.length ? ':' : '.'}
                  {warning.rejected.length ? (
                    <ul className={styles.rejected}>
                      {warning.rejected.map((r, i) => (
                        <li key={i}>
                          <span className={styles.mono}>{r.type ?? 'event'}</span>
                          {r.item_id ? (
                            <>
                              {' '}
                              for item <span className={styles.mono}>{r.item_id}</span>
                            </>
                          ) : r.sequence != null ? (
                            <> #{r.sequence}</>
                          ) : null}
                          : {r.error ?? 'rejected'}
                        </li>
                      ))}
                      {warning.moreCount > 0 ? <li>and {warning.moreCount} more</li> : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {run.items_restricted ? (
          <div className={styles.banner} role="status" data-testid="private-test-set">
            <Icon name="info" size={16} />
            <div>
              <div className={styles.bannerTitle}>Private test set</div>
              <p className={styles.bannerBody}>
                This run was evaluated on a private test set. Scores and latencies are shown, but item inputs,
                expected outputs, outputs, traces, and analysis are visible to admins only.
              </p>
            </div>
          </div>
        ) : null}

        <div id="run-hero-details" hidden={!expanded} className={styles.details}>
          <dl className={styles.metaGrid}>
            <Meta label="Owner" title={ownerLabel}>
              <MetaLink to={links.owner} title={`Runs owned by ${ownerLabel}`}>
                {ownerLabel}
              </MetaLink>
            </Meta>
            <Meta label="Project" title={projectName}>
              <MetaLink to={links.project} title={`Runs in ${projectName}`}>
                {projectName}
              </MetaLink>
            </Meta>
            <Meta label="Version">{version ? <span className={styles.mono}>{version}</span> : null}</Meta>
            {viewPass ? null : <Meta label="Stop reason">{run.status_reason_label ?? ''}</Meta>}
          </dl>

          {context.length ? (
            <div className={styles.context}>
              <Text variant="sm" tone="muted" className={styles.contextTitle}>
                Execution context
              </Text>
              <KeyValueGrid
                columns={3}
                dense
                aria-label="Execution context"
                items={context.map((entry) => ({
                  key: `${entry.group}:${entry.key}`,
                  label: entry.label,
                  kind: entry.group === 'Config' ? 'config' : 'metadata',
                  mono: !entry.json,
                  value: entry.json ? (
                    <JsonPreview value={entry.raw} title={entry.label} compact />
                  ) : (
                    <span className={styles.ctxVal} title={entry.value}>
                      {entry.value}
                    </span>
                  ),
                }))}
              />
            </div>
          ) : null}
          {extra ? <div className={styles.context}>{extra}</div> : null}
        </div>
      </div>
    </Card>
  );
}
