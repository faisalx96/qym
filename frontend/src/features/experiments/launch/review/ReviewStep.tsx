import { useMemo, useRef } from 'react';
import type { EnvTasksPayload } from '@/api/launch';
import { useEnvTaskLists } from '@/api/launch';
import { useMediaQuery } from '@/features/shell';
import { Checkbox, Select, Tag } from '@/ui';
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
  taskChanged,
  unitsInfo,
  type DryRunJob,
  type Priority,
} from '../model';
import { LATENCY_REVIEW_LABEL, LATENCY_REVIEW_VALUE } from '../copy';
import { ChangesCard, ChecksCard, ReviewCard, ReviewKv, type ChangeRow, type KvRow } from './ReviewParts';
import styles from './reviewStep.module.css';

/** The task's name for the summary and the run rows: the service's name when its list was read, else the id. */
function taskName(
  id: string | null,
  lists: Readonly<Record<string, EnvTasksPayload | undefined>>,
): string {
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
  rows.push({
    key: 'prio',
    label: 'Priority',
    value: `${priorityLabel(fallback)}${(preview.data?.jobs?.length ?? 0) > 1 ? ' (the default of every run below)' : ''}`,
  });
  if (doc.latencySensitive)
    rows.push({ key: 'latency', label: LATENCY_REVIEW_LABEL, value: LATENCY_REVIEW_VALUE });
  if (selectedEnvs.length) rows.push({ key: 'versions', label: 'Versions', value: <VersionsSummary />, mono: true });
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
  swept: string;
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

/** Columns shown: `#`, the ones that vary, Priority (a column that carries one value for every run is not drawn). */
export function visibleColumns(rows: readonly RunRow[]): Array<'env' | 'dataset' | 'swept' | 'task'> {
  const out: Array<'env' | 'dataset' | 'swept' | 'task'> = [];
  for (const column of ['env', 'dataset', 'swept', 'task'] as const) {
    if (new Set(rows.map((r) => r[column])).size > 1) out.push(column);
  }
  return out;
}

const COLUMN_LABEL = { env: 'Environment', dataset: 'Dataset', swept: 'Swept setting', task: 'Task' } as const;

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
          items={options.map((o) => ({ key: o.value, label: o.label, description: o.description, disabled: o.disabled }))}
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

function RunsCard({ taskLists, onAckRef }: { taskLists: Record<string, EnvTasksPayload | undefined>; onAckRef: (el: HTMLElement | null) => void }) {
  const {
    doc,
    setDoc,
    ctx,
    review,
    preview,
    preemptionAck,
    setPreemptionAck,
    readOnly,
  } = useLaunch();
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
  const rows = useMemo<RunRow[]>(
    () =>
      (jobs ?? []).map((job, i) => ({
        key: jobKey(job),
        index: i + 1,
        job,
        env: job.environment_name ?? job.environment_id,
        dataset: datasetOfJob(job, doc),
        swept: job.label ?? '',
        task: job.task?.name ?? taskName(doc.selection.mixedTasks ? null : taskId, taskLists),
      })),
    [jobs, doc, taskId, taskLists],
  );
  const columns = visibleColumns(rows);
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
            {estimate.combos > 1 || envCount > 1 || pairs >= 2 ? <span className={styles.math}>{estimate.math}</span> : null}
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
                      setDoc((d) => setAllJobPriorities(d, rows.map((r) => r.key), String(key) as Priority, fallback))
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
          This would create {count.runs} runs; the limit is {count.cap} per launch. Remove sweep values or environments
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
                    <RunFact key={c} column={c} row={row} />
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
          <div className={styles.tableWrap}>
            <table className={styles.table} data-part="runs-table" aria-label="Runs to launch">
              <thead>
                <tr>
                  <th scope="col" className={styles.num}>
                    #
                  </th>
                  {columns.map((c) => (
                    <th key={c} scope="col">
                      {COLUMN_LABEL[c]}
                    </th>
                  ))}
                  <th scope="col">Priority</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-run={row.index}>
                    <td className={styles.num}>{row.index}</td>
                    {columns.map((c) => (
                      <td key={c} className={c === 'dataset' ? styles.mono : undefined}>
                        <RunFact column={c} row={row} bare />
                      </td>
                    ))}
                    <td>
                      <PriorityCell row={row} fallback={fallback} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </ReviewCard>
  );
}

function RunFact({ column, row, bare }: { column: 'env' | 'dataset' | 'swept' | 'task'; row: RunRow; bare?: boolean }) {
  const value =
    column === 'swept' ? (
      row.swept ? <Tag kind="data">{row.swept}</Tag> : '—'
    ) : (
      row[column]
    );
  if (bare) return <>{value}</>;
  return (
    <>
      <dt>{COLUMN_LABEL[column]}</dt>
      <dd className={column === 'dataset' ? styles.mono : undefined}>{value}</dd>
    </>
  );
}

/** Rows of "Changes from the starting point" with their Edit actions. */
function useChangeRows(): ChangeRow[] {
  const { doc, ctx, sectionSummary, focusField, revealStep } = useLaunch();
  const goTo = useGoToSection();
  const sweepAxes = useMemo(
    () => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes.length,
    [doc, ctx.evaluatorPanel],
  );
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
    const changes = id === 'sweeps' ? sweepAxes : sectionSummary(id).changes;
    if (!changes) continue;
    const label =
      id === 'sweeps'
        ? `${SECTION_TITLES[id]}: ${plural(changes, 'swept setting')}`
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
  const changeRows = useChangeRows();
  const ackRef = useRef<HTMLElement | null>(null);
  return (
    <div className={styles.stack} data-testid="review-step">
      <SummaryCard taskLists={taskLists} />
      <RunsCard taskLists={taskLists} onAckRef={(el) => (ackRef.current = el)} />
      <div className={styles.twoCol}>
        <ChangesCard rows={changeRows} base={doc.environmentIds.length ? baseState.label : 'the starting point'} />
        <ChecksCard warnings={preview.data?.warnings ?? []}>
          {readOnly ? <Callout tone="warning">Archived project: read only.</Callout> : null}
        </ChecksCard>
      </div>
    </div>
  );
}
