import { Fragment, useMemo, useRef } from 'react';
import type { EnvTasksPayload } from '@/api/launch';
import { useEnvTaskLists } from '@/api/launch';
import { readOnlyReason, useMediaQuery, useOptionalProject } from '@/features/shell';
import { Checkbox, DataTable, Select, Tag, type Column } from '@/ui';
import { plural } from '../../lib/format';
import { Callout } from '../components/Callout';
import { useGoToSection } from '../components/goToSection';
import { VersionsSummary } from '../entry/VersionsBlock';
import { useLaunch, SECTION_IDS, SECTION_TITLES, type SectionId } from '../LaunchContext';
import {
  axesOf,
  baseLabel,
  buildSpec,
  datasetChanged,
  datasetEntries,
  datasetValue,
  defaultRunPriority,
  highEnvironments,
  highRunCount,
  jobKey,
  locate,
  pairCount,
  pointerToFieldName,
  PRIORITIES,
  priorityLabel,
  refLabel,
  runEstimate,
  runPriority,
  runPriorityOptions,
  runShapeChanged,
  setAllJobPriorities,
  setJobPriority,
  sweepAxesText,
  sweepColumns,
  sweepLines,
  sweepValue,
  taskChanged,
  unitsInfo,
  type DryRunJob,
  type FormContext,
  type Priority,
  type SweepColumn,
} from '../model';
import { LATENCY_REVIEW_LABEL, LATENCY_REVIEW_VALUE } from '../copy';
import { ChangesCard, ChecksCard, ReviewCard, ReviewKv, type ChangeRow, type KvRow } from './ReviewParts';
import styles from './reviewStep.module.css';

/** The task's name for the summary and the run rows: the service's name when its list was read, else the id. */
function taskName(id: string | null, lists: Readonly<Record<string, EnvTasksPayload | undefined>>): string {
  if (!id) return 'Worker default';
  for (const list of Object.values(lists)) {
    const found = list?.tasks.find((t) => t.id === id);
    if (found) return found.name;
  }
  return id;
}

function DatasetValue() {
  const { doc } = useLaunch();
  const entries = datasetEntries(doc);
  if (entries.length < 2 && pairCount(doc) < 2) return <>{datasetValue(doc) || '—'}</>;
  return (
    <>
      {entries.map((e) => (
        <span key={e.name}>
          {e.name}{' '}
          <span className={styles.kvSub}>
            {e.refs.map((r) => refLabel(r).replace(/^Latest version$/, 'latest')).join(', ')}
          </span>
        </span>
      ))}
    </>
  );
}

/** A connection's name by id, from the selected environments' model options. */
function connectionNamer(ctx: FormContext): (id: string) => string | undefined {
  return (id) => {
    for (const env of ctx.envs) {
      const found = env.options?.connections.find((c) => c.connection_id === id);
      if (found) return found.name;
    }
    return undefined;
  };
}

const labelOf = (ctx: FormContext) => (pointer: string) => locate(pointer, ctx).label;

/** The Summary's "Swept settings" row (round 10, C-2-8): one line per axis, `name: v1, v2, v3`; a linked axis pairs. */
function SweptSettings({
  ctx,
  axes,
}: {
  ctx: FormContext;
  axes: NonNullable<ReturnType<typeof useLaunch>['preview']['data']>['axes'];
}) {
  const lines = sweepLines(axes ?? [], labelOf(ctx), connectionNamer(ctx));
  return (
    <ul className={styles.swept} data-part="review-swept">
      {lines.map((line) => (
        <li key={line.names.join('+')} className={styles.sweptLine} data-part="swept-axis">
          <span className={styles.sweptName}>{`${line.names.join(' + ')}:`}</span>{' '}
          <span className={styles.sweptValues}>
            {line.values.map((step, s) => (
              <span key={s} className={styles.sweptValue}>
                {step.map((v, m) => (
                  <Fragment key={m}>
                    {m ? <span className={styles.sweptJoin}> + </span> : null}
                    <span className={line.mono[m] ? styles.mono : undefined}>{v}</span>
                  </Fragment>
                ))}
                {s < line.values.length - 1 ? ', ' : null}
              </span>
            ))}
            {line.linked ? ' ' : null}
            {line.linked ? (
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

function SummaryCard({ taskLists }: { taskLists: Record<string, EnvTasksPayload | undefined> }) {
  const { doc, selectedEnvs, ctx, preview } = useLaunch();
  const pairs = pairCount(doc);
  const envCount = doc.environmentIds.length;
  const fallback = defaultRunPriority(doc, ctx, preview.data);
  const mixed = doc.selection.mixedTasks;
  const rows: KvRow[] = [
    { key: 'name', label: 'Name', value: doc.name.trim() || '—' },
    {
      key: 'base',
      label: 'Starts from',
      value: envCount ? baseLabel(doc, (id) => selectedEnvs.find((e) => e.id === id)?.name ?? id) : '—',
    },
    {
      key: 'task',
      label: 'Task',
      value: mixed ? 'Different per environment' : taskName(doc.selection.task, taskLists),
    },
    { key: 'env', label: 'Environments', value: selectedEnvs.map((e) => e.name).join(', ') || '—' },
    {
      key: 'ds',
      label: pairs >= 2 || datasetEntries(doc).length > 1 ? 'Datasets' : 'Dataset',
      value: <DatasetValue />,
      mono: true,
    },
  ];
  if (pairs >= 2)
    rows.push({
      key: 'shape',
      label: 'Run shape',
      value: doc.selection.runShape === 'combined' ? 'Combine into one run' : 'One run each',
    });
  const axes = preview.data?.axes ?? [];
  if (axes.length)
    rows.push({ key: 'swept', label: 'Swept settings', value: <SweptSettings ctx={ctx} axes={axes} /> });
  rows.push({
    key: 'prio',
    label: 'Priority',
    value: `${priorityLabel(fallback)}${(preview.data?.jobs?.length ?? 0) > 1 ? ' (the default of every run below)' : ''}`,
  });
  if (doc.latencySensitive)
    rows.push({ key: 'latency', label: LATENCY_REVIEW_LABEL, value: LATENCY_REVIEW_VALUE });
  if (selectedEnvs.length) rows.push({ key: 'versions', label: 'Versions', value: <VersionsSummary /> });
  return (
    <ReviewCard title="Summary" part="review-summary" label="Summary">
      <ReviewKv rows={rows} />
    </ReviewCard>
  );
}

interface RunRow {
  key: string;
  index: number;
  job: DryRunJob;
  env: string;
  dataset: string;
  /** One value per swept column, from `job.params.sweep[pointer]` (never parsed from the label). */
  sweep: string[];
  task: string;
}

function datasetOfJob(job: DryRunJob, doc: ReturnType<typeof useLaunch>['doc']): string {
  const one = job.dataset;
  const label = (d: { dataset: string; version?: string | null; alias?: string | null }) =>
    `${d.dataset} ${d.version ? d.version : d.alias ? d.alias : 'latest'}`;
  if (one) return label(one);
  if (job.datasets?.length) return job.datasets.map(label).join(' + ');
  return datasetValue(doc) || '—';
}

type FactColumn = 'env' | 'dataset' | 'task';

/** A run-table column: a fact (environment, dataset, task) or one swept setting (its index in `RunRow.sweep`). */
export type RunColumn =
  { kind: 'fact'; id: FactColumn } | { kind: 'sweep'; index: number; column: SweepColumn };

/**
 * Columns shown between `#` and Priority (round 10, C-2-1): the varying ones of Environment and Dataset, one per swept
 * setting in axis order, then Task if it varies. A column that carries one value for every run is not drawn.
 */
export function visibleColumns(rows: readonly RunRow[], sweeps: readonly SweepColumn[] = []): RunColumn[] {
  const varies = (values: string[]) => new Set(values).size > 1;
  const out: RunColumn[] = [];
  for (const id of ['env', 'dataset'] as const)
    if (varies(rows.map((r) => r[id]))) out.push({ kind: 'fact', id });
  sweeps.forEach((column, index) => {
    if (varies(rows.map((r) => r.sweep[index] ?? ''))) out.push({ kind: 'sweep', index, column });
  });
  if (varies(rows.map((r) => r.task))) out.push({ kind: 'fact', id: 'task' });
  return out;
}

const COLUMN_LABEL: Record<FactColumn, string> = { env: 'Environment', dataset: 'Dataset', task: 'Task' };

/** A swept setting's header: its name and, only when two columns share the name, the section on a second line. */
function AxisHeader({ column }: { column: SweepColumn }) {
  return (
    <span className={styles.axisHead} data-part="axis-header">
      <span>{column.name}</span>
      {column.section ? (
        <span className={styles.axisSection} data-part="axis-section">
          {column.section}
        </span>
      ) : null}
    </span>
  );
}

function tableColumns(columns: readonly RunColumn[], fallback: Priority): Column<RunRow>[] {
  return [
    {
      id: 'n',
      header: '#',
      label: 'Run number',
      type: 'number',
      width: 48,
      minWidth: 48,
      resizable: false,
      cell: (r) => r.index,
    },
    ...columns.map((c): Column<RunRow> => {
      if (c.kind === 'sweep')
        return {
          id: `sweep-${c.index}`,
          header: <AxisHeader column={c.column} />,
          label: c.column.label,
          group: c.column.group,
          type: 'text',
          mono: c.column.mono,
          flex: true,
          minWidth: 120,
          cell: (r) => (
            <span className={styles.axisCell} data-part="axis-cell">
              {r.sweep[c.index] ?? '—'}
            </span>
          ),
        };
      return {
        id: c.id,
        header: COLUMN_LABEL[c.id],
        type: c.id === 'dataset' ? 'id' : 'text',
        flex: true,
        // Environment shares the row with the swept columns (round 10, C-2-5); Dataset and Task keep their width
        ...(c.id === 'env' ? { minWidth: 120 } : { width: 180 }),
        cell: (r) => r[c.id],
      };
    }),
    {
      id: 'priority',
      header: 'Priority',
      width: 240,
      minWidth: 240,
      resizable: false,
      cell: (r) => <PriorityCell row={r} fallback={fallback} />,
    },
  ];
}

function PriorityCell({ row, fallback }: { row: RunRow; fallback: Priority }) {
  const { doc, setDoc, ctx, readOnly } = useLaunch();
  const env = ctx.envs.find((e) => e.id === row.job.environment_id);
  const value = runPriority(doc, row.key, fallback);
  const options = runPriorityOptions(env?.maxPriority, row.env, ctx.isManager);
  const changed = doc.jobPriorities[row.key] !== undefined;
  return (
    <span className={styles.prioCell}>
      <span className={styles.prio} data-part="run-priority">
        <Select
          label={`Priority of run ${row.index}`}
          hideLabel
          items={options.map((o) => ({
            key: o.value,
            label: o.label,
            description: o.description,
            disabled: o.disabled,
          }))}
          value={value}
          isDisabled={readOnly}
          onChange={(key) =>
            key != null && setDoc((d) => setJobPriority(d, row.key, String(key) as Priority, fallback))
          }
        />
      </span>
      {changed ? (
        <span className={styles.changed} data-part="run-changed">
          <span className={styles.dot} aria-hidden="true" />
          changed
        </span>
      ) : null}
    </span>
  );
}

function RunsCard({
  taskLists,
  onAckRef,
}: {
  taskLists: Record<string, EnvTasksPayload | undefined>;
  onAckRef: (el: HTMLElement | null) => void;
}) {
  const { doc, setDoc, ctx, review, preview, preemptionAck, setPreemptionAck, readOnly } = useLaunch();
  const phone = useMediaQuery('(max-width: 760px)');
  const { count } = review;
  const envCount = doc.environmentIds.length;
  const pairs = pairCount(doc);
  const units = useMemo(() => unitsInfo(doc, ctx.envs), [doc, ctx.envs]);
  const estimate = useMemo(
    () => runEstimate(buildSpec(doc, ctx.evaluatorPanel), envCount, count.cap, units),
    [doc, ctx.evaluatorPanel, envCount, count.cap, units],
  );
  const fallback = defaultRunPriority(doc, ctx, preview.data);
  const jobs = preview.data?.jobs;
  const taskId = doc.selection.task;
  const axes = preview.data?.axes;
  const sweeps = useMemo(() => sweepColumns(axes ?? [], labelOf(ctx)), [axes, ctx]);
  const rows = useMemo<RunRow[]>(() => {
    const named = connectionNamer(ctx);
    return (jobs ?? []).map((job, i) => {
      const swept = (job.params?.sweep ?? {}) as Record<string, unknown>;
      return {
        key: jobKey(job),
        index: i + 1,
        job,
        env: job.environment_name ?? job.environment_id,
        dataset: datasetOfJob(job, doc),
        sweep: sweeps.map((c) => (c.pointer in swept ? sweepValue(swept[c.pointer], named) : '—')),
        task: job.task?.name ?? taskName(doc.selection.mixedTasks ? null : taskId, taskLists),
      };
    });
  }, [jobs, doc, taskId, taskLists, sweeps, ctx]);
  const columns = visibleColumns(rows, sweeps);
  const highCount = highRunCount(doc, jobs, fallback);
  const highEnvs = highEnvironments(doc, jobs, fallback);
  const several = rows.length > 1;
  const anyChanged = Object.keys(doc.jobPriorities).length > 0;
  const allValue = (() => {
    const values = new Set(rows.map((r) => runPriority(doc, r.key, fallback)));
    return values.size === 1 ? ([...values][0] as Priority) : null;
  })();
  return (
    <ReviewCard
      part="review-runs"
      label="Runs to launch"
      head={
        <div className={styles.head}>
          <h3 className={styles.headTitle}>
            <span className={styles.count} data-part="run-count" data-over={count.over} aria-live="polite">
              {count.runs}
            </span>
            {count.runs === 1 ? 'run' : 'runs'} to launch
          </h3>
          <div className={styles.tools}>
            {estimate.combos > 1 || envCount > 1 || pairs >= 2 ? (
              <span className={styles.math}>{estimate.math}</span>
            ) : null}
            {several ? (
              <>
                <span className={styles.toolLabel}>Set every run to</span>
                <span className={styles.setAll} data-part="review-priority-all">
                  <Select
                    label="Set every run to"
                    hideLabel
                    items={PRIORITIES.map((p) => ({
                      key: p,
                      label: priorityLabel(p),
                      disabled: !ctx.isManager && p === 'HIGH',
                      description: !ctx.isManager && p === 'HIGH' ? 'Only project managers' : undefined,
                    }))}
                    value={allValue ?? fallback}
                    isDisabled={readOnly}
                    onChange={(key) =>
                      key != null &&
                      setDoc((d) =>
                        setAllJobPriorities(
                          d,
                          rows.map((r) => r.key),
                          String(key) as Priority,
                          fallback,
                        ),
                      )
                    }
                  />
                </span>
                {anyChanged ? (
                  <button
                    type="button"
                    className={styles.changed}
                    onClick={() => setDoc((d) => ({ ...d, jobPriorities: {} }))}
                  >
                    Reset
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      }
    >
      {count.over ? (
        <Callout tone="error" live title="Over the run limit">
          This would create {count.runs} runs; the limit is {count.cap} per launch. Remove sweep values or
          environments
          {pairs >= 2 && doc.selection.runShape === 'one_each' ? ', or choose “Combine into one run”' : ''}.
        </Callout>
      ) : null}
      {highCount > 0 ? (
        <div className={styles.ack} data-part="review-ack" ref={onAckRef}>
          <span className={styles.ackTitle}>
            {highCount === 1 ? '1 run is High.' : `${highCount} runs are High.`}
          </span>
          <span>
            {preview.data?.preemption_warning ??
              `High runs can preempt other work on ${highEnvs.join(', ')}.`}
          </span>
          <Checkbox isSelected={preemptionAck} isDisabled={readOnly} onChange={setPreemptionAck}>
            I understand that High runs can preempt other work
          </Checkbox>
        </div>
      ) : null}
      {several ? (
        phone ? (
          <ul className={styles.runCards} data-part="runs-cards">
            {rows.map((row) => (
              <li key={row.key} className={styles.runCard} data-run={row.index}>
                <dl style={{ display: 'contents' }}>
                  <dt>Run</dt>
                  <dd className={styles.mono}>{row.index}</dd>
                  {columns.map((c) => (
                    <RunFact key={c.kind === 'fact' ? c.id : `sweep-${c.index}`} column={c} row={row} />
                  ))}
                  <dt>Priority</dt>
                  <dd>
                    <PriorityCell row={row} fallback={fallback} />
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.tableWrap} data-part="runs-table">
            <DataTable<RunRow>
              aria-label="Runs to launch"
              columns={tableColumns(columns, fallback)}
              rows={rows}
              rowKey={(r) => r.key}
              density="compact"
              variant="embedded"
              columnMenu={false}
              stickyHeader={false}
              responsive="scroll"
              rowProps={(r) => ({ 'data-run': String(r.index) })}
            />
          </div>
        )
      ) : null}
    </ReviewCard>
  );
}

function RunFact({ column, row }: { column: RunColumn; row: RunRow }) {
  if (column.kind === 'sweep')
    return (
      <>
        <dt data-part="axis-header">{column.column.label}</dt>
        <dd className={column.column.mono ? styles.mono : undefined} data-part="axis-cell">
          {row.sweep[column.index] ?? '—'}
        </dd>
      </>
    );
  return (
    <>
      <dt>{COLUMN_LABEL[column.id]}</dt>
      <dd className={column.id === 'dataset' ? styles.mono : undefined}>{row[column.id]}</dd>
    </>
  );
}

/** Rows of "Changes from the starting point" with their Edit actions. */
function useChangeRows(): ChangeRow[] {
  const { doc, ctx, sectionSummary, focusField, revealStep } = useLaunch();
  const goTo = useGoToSection();
  const sweepAxes = useMemo(() => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes, [doc, ctx.evaluatorPanel]);
  const rows: ChangeRow[] = [];
  const several = datasetEntries(doc).length > 1 || pairCount(doc) > 1;
  if (datasetChanged(doc)) {
    rows.push({
      key: 'dataset',
      label: several ? 'Datasets changed' : 'Dataset changed',
      onEdit: () => {
        revealStep('where');
        focusField(pointerToFieldName(several ? '/evaluator/datasets/0' : '/evaluator/dataset'));
      },
    });
  }
  if (pairCount(doc) >= 2 && runShapeChanged(doc, doc.baseline.selection)) {
    rows.push({
      key: 'shape',
      label: 'Run shape changed',
      onEdit: () => {
        revealStep('where');
        focusField(pointerToFieldName('/evaluator/run_shape'));
      },
    });
  }
  if (taskChanged(doc, doc.baseline.selection)) {
    rows.push({
      key: 'task',
      label: 'Task changed',
      onEdit: () => {
        revealStep('where');
        focusField(pointerToFieldName('/evaluator/task'));
      },
    });
  }
  for (const id of SECTION_IDS as readonly SectionId[]) {
    if (id === 'raw') continue;
    const changes = id === 'sweeps' ? sweepAxes.length : sectionSummary(id).changes;
    if (!changes) continue;
    // the swept settings by name (round 10, C-2-9), not a count
    const label =
      id === 'sweeps'
        ? `${SECTION_TITLES[id]}: ${sweepAxesText(sweepAxes, (p) => locate(p, ctx).label)}`
        : `${SECTION_TITLES[id]}: ${plural(changes, 'change')}`;
    rows.push({ key: id, label, onEdit: () => goTo(id) });
  }
  return rows;
}

/**
 * The Review step (launch mode): Summary, runs to launch (one row per run, a priority select each), then Changes and
 * Checks side by side. It is rendered on this step only; every other step shows its own content.
 */
export function ReviewStep() {
  const { doc, selectedEnvs, projectId, preview, readOnly, baseState } = useLaunch();
  const taskLists = useEnvTaskLists(projectId, selectedEnvs);
  const projectContext = useOptionalProject();
  const changeRows = useChangeRows();
  const ackRef = useRef<HTMLElement | null>(null);
  return (
    <div className={styles.stack} data-testid="review-step">
      <SummaryCard taskLists={taskLists} />
      <RunsCard taskLists={taskLists} onAckRef={(el) => (ackRef.current = el)} />
      <div className={styles.twoCol}>
        <ChangesCard
          rows={changeRows}
          base={doc.environmentIds.length ? baseState.label : 'the starting point'}
        />
        <ChecksCard warnings={preview.data?.warnings ?? []}>
          {readOnly ? (
            <Callout tone="warning">
              Read only: {projectContext ? readOnlyReason(projectContext) : 'This project is archived.'}
            </Callout>
          ) : null}
        </ChecksCard>
      </div>
    </div>
  );
}
