import { useMemo } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import { useEnvTaskLists, type EnvTasksPayload } from '@/api/launch';
import { Card, Select, Tag, Text } from '@/ui';
import { pointerToFieldName, setTask } from '../model';
import { useLaunch } from '../LaunchContext';
import panel from '../components/launch.module.css';
import styles from './entry.module.css';

export const DEFAULT_TASK = '__worker_default';

export interface TaskOption {
  key: string;
  label: string;
  description?: string;
}

/** Names of environments joined for a description: "production", "production and staging", "a, b and c". */
export function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The Task select's items: "Worker default" first, then the union of the ticked environments' tasks, de-duplicated
 * by id in the order of first appearance. Each item says which ticked environments offer it. A chosen task none of
 * them lists stays visible (a clone or starting point may carry it).
 */
export function taskOptions(
  envs: ReadonlyArray<Pick<EvalEnvironment, 'id' | 'name'>>,
  lists: Readonly<Record<string, EnvTasksPayload | undefined>>,
  chosen: string | null,
): TaskOption[] {
  const out: TaskOption[] = [{ key: DEFAULT_TASK, label: 'Worker default', description: 'Every environment runs its own default' }];
  const seen = new Map<string, { name: string; description: string | null; offeredBy: string[] }>();
  for (const env of envs) {
    const list = lists[env.id];
    if (!list || list.status !== 'ok') continue;
    for (const t of list.tasks) {
      const known = seen.get(t.id);
      if (known) known.offeredBy.push(env.name);
      else seen.set(t.id, { name: t.name, description: t.description, offeredBy: [env.name] });
    }
  }
  for (const [id, t] of seen) {
    const who = t.offeredBy.length === envs.length ? joinNames(t.offeredBy) : `${joinNames(t.offeredBy)} only`;
    out.push({ key: id, label: t.name, description: [t.description, who].filter(Boolean).join(' · ') });
  }
  if (chosen && !seen.has(chosen)) out.push({ key: chosen, label: chosen });
  return out;
}

/** Whether a ticked environment offers a task: needs the capability and, when its list was read, the id in it. */
export function offersTask(
  env: Pick<EvalEnvironment, 'id' | 'evaluator_capabilities'>,
  list: EnvTasksPayload | undefined,
  task: string,
): boolean {
  if (!env.evaluator_capabilities?.task) return false;
  if (list && list.status === 'ok') return list.tasks.some((t) => t.id === task);
  return true;
}

/**
 * The Task section (decision I1, one task per experiment): one select above Environments and Datasets, an availability
 * row (which ticked environment offers the chosen task) and one line of help. Rendered when at least one active
 * environment of the project declares `task`, so ticking never changes the page height; disabled until one is ticked.
 */
export function TaskCard() {
  const { envRecords, selectedEnvs, doc, setDoc, readOnly, registerField, projectId } = useLaunch();
  const lists = useEnvTaskLists(projectId, selectedEnvs);
  const chosen = doc.selection.task;
  const mixed = doc.selection.mixedTasks;
  const items = useMemo(() => taskOptions(selectedEnvs, lists, chosen), [selectedEnvs, lists, chosen]);
  const offering = envRecords.some((e) => e.evaluator_capabilities?.task);
  if (!offering) return null;
  const none = selectedEnvs.length === 0;
  const reading = selectedEnvs.some(
    (e) => e.evaluator_capabilities?.task && lists[e.id] === undefined,
  );
  const failed = selectedEnvs.filter((e) => lists[e.id]?.status === 'error');
  return (
    <div data-part="task-section">
      <Card as="section" aria-label="Task">
        <div className={panel.cardStack}>
          <div className={styles.taskHead}>
            <Text variant="md" weight={600} as="h3">
              Task
            </Text>
            <Text variant="sm" tone="muted">
              One task for the whole experiment
            </Text>
          </div>
          <div className={styles.taskRow}>
            {reading && !none ? (
              <span className={styles.taskSkel} aria-hidden="true" data-part="task-select" />
            ) : (
              <div
                className={styles.taskSelect}
                data-part="task-select"
                ref={(el) => registerField(pointerToFieldName('/evaluator/task'), el)}
              >
                <Select
                  label="Task"
                  hideLabel
                  items={items}
                  value={mixed ? DEFAULT_TASK : (chosen ?? DEFAULT_TASK)}
                  placeholder={mixed ? 'Different per environment' : undefined}
                  isDisabled={readOnly || none || Boolean(mixed)}
                  onChange={(key) => key != null && setDoc((d) => setTask(d, key === DEFAULT_TASK ? null : String(key)))}
                  renderValue={mixed ? () => 'Different per environment' : undefined}
                />
              </div>
            )}
            <span className={styles.avail} data-part="task-availability" role="status">
              {none ? (
                <span className={styles.availLabel}>Pick an environment first</span>
              ) : reading ? (
                <span className={styles.availLabel}>Reading tasks…</span>
              ) : chosen ? (
                <>
                  <span className={styles.availLabel}>Offered by</span>
                  {selectedEnvs.map((env) => {
                    const ok = offersTask(env, lists[env.id], chosen);
                    return ok ? (
                      <Tag key={env.id} tone="success" data-offered="true">
                        {env.name}
                      </Tag>
                    ) : (
                      <Tag key={env.id} tone="danger" data-offered="false">
                        {env.name}: not offered
                      </Tag>
                    );
                  })}
                </>
              ) : mixed ? (
                <span className={styles.availLabel}>Cloned from an experiment that ran a different task per environment</span>
              ) : (
                <span className={styles.availLabel}>Every ticked environment runs its Worker default</span>
              )}
            </span>
          </div>
          {failed.length ? (
            <p className={styles.errorText}>
              Couldn’t read the tasks of {failed.map((e) => e.name).join(', ')}: {lists[failed[0]!.id]?.error || 'unknown error'}
            </p>
          ) : null}
          <p className={styles.help}>
            The list is what the ticked environments offer. An environment that does not offer the chosen task is flagged and
            blocks the launch until the task or the environment changes.
          </p>
        </div>
      </Card>
    </div>
  );
}
