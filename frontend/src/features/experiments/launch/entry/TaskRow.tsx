import { useMemo } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import { useEnvTasks } from '@/api/launch';
import { Select } from '@/ui';
import { pointerToFieldName, setTask } from '../model';
import { useLaunch } from '../LaunchContext';
import styles from './entry.module.css';

const DEFAULT_KEY = '__worker_default';

/**
 * The task an Evaluation Service runs, inside the ticked environment's box under its `Versions` line. It exists
 * only when the environment's stored evaluator schema declares `task`; the list is read live (one query per
 * environment, shared with Customize and read again on the box's Refresh). A service that answers 404, 405 or
 * 422 is treated as one without tasks: no row, no error.
 */
export function EnvTask({ env, projectId }: { env: EvalEnvironment; projectId: string }) {
  if (!env.evaluator_capabilities?.task) return null;
  return <TaskRow env={env} projectId={projectId} />;
}

function TaskRow({ env, projectId }: { env: EvalEnvironment; projectId: string }) {
  const { doc, setDoc, readOnly, registerField } = useLaunch();
  const query = useEnvTasks(projectId, env.id, true);
  const data = query.data;
  const chosen = doc.selection.tasks[env.id] ?? null;
  const items = useMemo(() => {
    const out = [{ key: DEFAULT_KEY, label: 'Worker default', description: undefined as string | undefined }];
    for (const t of data?.tasks ?? [])
      out.push({ key: t.id, label: t.name, description: t.description ?? undefined });
    // A starting point may carry a task the list no longer shows: keep it visible and selectable.
    if (chosen && !out.some((o) => o.key === chosen)) out.push({ key: chosen, label: chosen, description: undefined });
    return out;
  }, [data?.tasks, chosen]);
  const status = query.isPending || query.isFetching ? 'loading' : query.isError ? 'error' : data?.status;
  if (status === 'unsupported') return null;
  return (
    <div className={styles.taskLine} data-env-task={env.id} data-status={status}>
      <span className={styles.versionLabel}>Task</span>
      {status === 'loading' ? (
        // The loaded row's height with a placeholder, so the box does not move when it fills.
        <>
          <span className={styles.srOnly} role="status">
            Reading tasks…
          </span>
          <span className={styles.taskSkel} aria-hidden="true" />
        </>
      ) : status === 'error' ? (
        <span className={[styles.errorText, styles.taskError].join(' ')}>
          Couldn’t read tasks: {data?.error || (query.error instanceof Error ? query.error.message : 'unknown error')}
        </span>
      ) : !data?.tasks.length && !chosen ? (
        <Select
          label={`Task of ${env.name}`}
          hideLabel
          items={[{ key: DEFAULT_KEY, label: 'No tasks listed' }]}
          value={DEFAULT_KEY}
          onChange={() => undefined}
          isDisabled
        />
      ) : (
        <div ref={(el) => registerField(pointerToFieldName(`/evaluator/task/${env.id}`), el)}>
          <Select
            label={`Task of ${env.name}`}
            hideLabel
            items={items}
            value={chosen ?? DEFAULT_KEY}
            isDisabled={readOnly}
            onChange={(key) => key != null && setDoc((d) => setTask(d, env.id, key === DEFAULT_KEY ? null : String(key)))}
          />
        </div>
      )}
    </div>
  );
}
