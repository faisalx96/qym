import { Skeleton } from '@/ui';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { AlsoSent } from '../evaluation/AlsoSent';
import { FieldControl } from '../evaluation/FieldControl';
import { OtherValues } from '../evaluation/OtherValues';
import { PlatformOwned } from '../evaluation/PlatformOwned';
import { RunMetadata } from '../evaluation/RunMetadata';
import { evaluatorFields } from '../model';
import styles from '../evaluation/evaluation.module.css';

/**
 * Evaluation configurations: the evaluator's inputs on top of the starting point, run metadata,
 * the keys that only Raw JSON or the base carry, and what the platform sets itself.
 */
export function EvaluationSection() {
  const { doc, ctx, flags } = useLaunch();
  const fields = evaluatorFields(doc, ctx);
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
            <div className={styles.grid}>
              {fields.map((f) => (
                <FieldControl key={f.name} field={f} />
              ))}
            </div>
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
