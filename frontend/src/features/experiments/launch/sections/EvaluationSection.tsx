import { Button, Skeleton } from '@/ui';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { AlsoSent } from '../evaluation/AlsoSent';
import { FieldControl } from '../evaluation/FieldControl';
import { OtherValues } from '../evaluation/OtherValues';
import { PlatformOwned } from '../evaluation/PlatformOwned';
import { RunMetadata } from '../evaluation/RunMetadata';
import { acceptsDatasets, acceptsTask, evaluatorFields } from '../model';
import styles from '../evaluation/evaluation.module.css';

/** The evaluator inputs that "Where it runs" sets for an environment that accepts datasets and tasks (C172). */
export const SET_IN_WHERE = ['task_name', 'dataset_version', 'dataset_alias'];

/**
 * Evaluation configurations: the evaluator's inputs on top of the starting point, run metadata,
 * the keys that only Raw JSON or the base carry, and what the platform sets itself. In the launch wizard
 * (`inWizard`), when every ticked environment accepts datasets and tasks, step 1 sets the task and the dataset, so
 * their inputs leave this step for one read-only line with an Edit button (C172).
 */
export function EvaluationSection({ inWizard }: { inWizard?: boolean } = {}) {
  const { doc, ctx, flags, revealStep } = useLaunch();
  const envs = doc.environmentIds.map((id) => ctx.envs.find((e) => e.id === id));
  const setInWhere =
    Boolean(inWizard) && envs.length > 0 && envs.every((e) => acceptsDatasets(e) && acceptsTask(e));
  const all = evaluatorFields(doc, ctx);
  const fields = setInWhere ? all.filter((f) => !SET_IN_WHERE.includes(f.name)) : all;
  const moved = all.length !== fields.length;
  const loading = !ctx.evaluatorPanel && doc.environmentIds.length > 0;
  return (
    <LaunchSection
      id="evaluation"
      title="Evaluation configurations"
      description="How the evaluator runs: inputs, run metadata and what the platform sets."
    >
      <div className={styles.stack}>
        <section className={styles.panel} aria-label="Evaluation inputs">
          <h4 className={styles.panelTitle}>Evaluation inputs</h4>
          {loading || flags.envsLoading ? (
            <Skeleton kind="lines" rows={3} label="Loading evaluation inputs" />
          ) : fields.length ? (
            <>
              <div className={styles.grid}>
                {fields.map((f) => (
                  <FieldControl key={f.name} field={f} />
                ))}
              </div>
              {moved ? (
                <div className={styles.readonlyRow} data-testid="set-in-where">
                  <span>Dataset and task are set in Where it runs.</span>
                  <Button variant="ghost" size="sm" onPress={() => revealStep('where')}>
                    Edit
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.hint}>
              {doc.environmentIds.length
                ? 'This environment has no evaluation inputs.'
                : 'Pick an environment to see its evaluation inputs.'}
            </p>
          )}
        </section>
        <OtherValues />
        <RunMetadata />
        <AlsoSent />
        <PlatformOwned />
      </div>
    </LaunchSection>
  );
}
