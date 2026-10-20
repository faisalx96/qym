/**
 * Run hero (round 3 P6): three compact bands, everything about what was run visible without a click. Band 1: identity
 * and actions. Band 2: seven labelled facts. Band 3: versioning, config and metadata as chips, clamped to two lines
 * (three on a phone) with "+ N more". Nothing hides behind a chevron.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { exportHtmlUrl } from '@/api/runs';
import { platformUrl } from '@/lib/runtime';
import {
  Button,
  Card,
  Collapse,
  CopyButton,
  DatasetTag,
  Icon,
  isBareRunId,
  JsonPreview,
  KeyValueTag,
  LinkButton,
  ModelTag,
  RunStatusBadge,
  Tag,
  TaskTag,
  runStatusTone,
  type CardTone,
} from '@/ui';
import { readJson, writeJson } from '@/lib/storage';
import type { LiveRunState } from '../hooks/useLiveRun';
import { useTicker } from '../hooks/useLiveRun';
import {
  formatDurationMs,
  formatIsoDateTime,
  heroTiming,
  headerChips,
  ingestWarning,
  isLiveStatus,
  runEntityLinks,
  stopReasonLine,
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
}

function Fact({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  if (children == null || children === '') return null;
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue} title={title}>
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

const MORE_KEY = 'qym:run-hero-more';

/** Band 3: the chip groups, clamped to two lines (three on compact), with an exact "+ N more". */
function ContextBand({
  groups,
  runId,
  stopReason,
  provisional,
}: {
  groups: ReturnType<typeof headerChips>;
  runId: string;
  stopReason: string;
  /** The header is the runs-list row (no config or metadata chips yet): hold the room the full chip band will take. */
  provisional?: boolean;
}) {
  const [open, setOpen] = useState(() => readJson<boolean>(MORE_KEY, false));
  const [hidden, setHidden] = useState(0);
  const flow = useRef<HTMLDivElement>(null);
  const total = groups.reduce((n, g) => n + g.chips.length, 0);
  useLayoutEffect(() => {
    const el = flow.current;
    if (!el) return undefined;
    const measure = () => {
      if (open) {
        setHidden(0);
        return;
      }
      const limit = el.clientHeight;
      const top = el.getBoundingClientRect().top;
      const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-chip]'));
      let n = 0;
      chips.forEach((c) => {
        if (c.getBoundingClientRect().bottom - top > limit + 1) n++;
      });
      setHidden((prev) => (prev === n ? prev : n));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, groups]);
  const toggle = () =>
    setOpen((v) => {
      writeJson(MORE_KEY, !v);
      return !v;
    });
  const showButton = open || hidden > 0;
  return (
    <div
      className={styles.context}
      role="group"
      aria-label="Versioning, config and metadata"
      data-testid="hero-context"
    >
      <div className={styles.contextRow}>
        <div
          ref={flow}
          id="run-hero-chips"
          className={styles.flow}
          data-open={open ? '' : undefined}
          data-total={total}
          data-provisional={provisional ? '' : undefined}
        >
          {groups.map((g) => (
            <div key={g.label} role="list" aria-label={g.label} className={styles.group}>
              {g.chips.map((c, i) => {
                const chip = (
                  <span role="listitem" data-chip="" className={styles.chipItem}>
                    <KeyValueTag label={c.label} text={c.text} title={c.title}>
                      {open && c.raw !== undefined ? (
                        <JsonPreview value={c.raw} title={c.key} compact />
                      ) : undefined}
                    </KeyValueTag>
                  </span>
                );
                return i === 0 ? (
                  <span key={c.key} className={styles.lead}>
                    <span className={styles.groupLabel} aria-hidden="true">
                      {g.label}
                    </span>
                    {chip}
                  </span>
                ) : (
                  <span key={c.key} className={styles.chipWrap}>
                    {chip}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        {showButton ? (
          <Button
            variant="ghost"
            size="sm"
            className={styles.moreBtn}
            aria-expanded={open}
            aria-controls="run-hero-more"
            onPress={toggle}
            iconEnd={<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />}
          >
            {open ? 'Show less' : `+ ${hidden} more`}
          </Button>
        ) : null}
      </div>
      <Collapse open={open} id="run-hero-more">
        <dl className={styles.moreFacts}>
          <Fact label="Run ID">
            <span className={styles.mono}>{runId}</span>
          </Fact>
          <Fact label="Stop reason">{stopReason}</Fact>
        </dl>
      </Collapse>
    </div>
  );
}

export function RunHero({ run, model, live, passSummary, slug, listParam, basePath }: RunHeroProps) {
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
  const groups = headerChips(run);
  const stop = viewPass ? null : stopReasonLine(run);
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
            <CopyButton text={run.run_id} label="Copy run id" />
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
          </div>
        </div>
        {stop ? (
          <p
            className={styles.stop}
            data-danger={stop.danger ? '' : undefined}
            data-testid="hero-stop-reason"
          >
            {stop.text}
          </p>
        ) : null}

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
        {run.items_restricted && run.items_restricted_reason === 'dataset_access' ? (
          <div className={styles.banner} role="status" data-testid="restricted-dataset-banner">
            <Icon name="lock" size={14} />
            <div>
              <div className={styles.bannerTitle}>Restricted dataset</div>
              <p className={styles.bannerBody}>
                This run was evaluated on a dataset you don’t have access to. Scores and latencies are shown,
                but item inputs, expected outputs, outputs, traces, and analysis are hidden.
              </p>
            </div>
          </div>
        ) : run.items_restricted ? (
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

        <dl className={styles.facts} aria-label="Run facts" data-testid="run-hero-strip">
          <Fact label="Task">
            <MetaLink to={links.task} title={`Runs of task ${run.task_name}`}>
              <TaskTag name={run.task_name} />
            </MetaLink>
          </Fact>
          <Fact label="Dataset">
            <MetaLink to={links.dataset} title={links.datasetTitle}>
              <DatasetTag
                name={run.dataset_name}
                version={run.dataset_version}
                aliases={run.dataset_aliases}
              />
            </MetaLink>
          </Fact>
          <Fact label="Model">
            {modelName ? (
              <MetaLink to={links.model} title={`Runs of model ${modelName}`}>
                <ModelTag
                  name={modelName}
                  title={modelName}
                  reasoning={!!(pass ? pass.trace_stats : run.trace_stats)?.has_reasoning}
                />
              </MetaLink>
            ) : null}
          </Fact>
          <Fact label="Owner" title={ownerLabel}>
            <MetaLink to={links.owner} title={`Runs owned by ${ownerLabel}`}>
              {ownerLabel}
            </MetaLink>
          </Fact>
          <Fact label="Project" title={projectName}>
            <MetaLink to={links.project} title={`Runs in ${projectName}`}>
              {projectName}
            </MetaLink>
          </Fact>
          <Fact label="Started">{formatIsoDateTime(timing.startedAt)}</Fact>
          <Fact label="Runtime">
            <span data-testid="hero-runtime" className={styles.mono}>
              {runtimeMs != null ? formatDurationMs(runtimeMs) : '—'}
            </span>
          </Fact>
        </dl>
        {groups.length ? (
          <ContextBand
            groups={groups}
            runId={run.run_id}
            stopReason={viewPass ? '' : (run.status_reason_label ?? '')}
            provisional={run.provisional === true}
          />
        ) : null}
      </div>
    </Card>
  );
}
