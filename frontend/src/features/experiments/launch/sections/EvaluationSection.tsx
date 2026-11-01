import { useId, useState, type ReactNode } from 'react';
import { Button, Collapse, Icon, Skeleton } from '@/ui';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { AlsoSent } from '../evaluation/AlsoSent';
import { FieldControl } from '../evaluation/FieldControl';
import { OtherValues } from '../evaluation/OtherValues';
import { PlatformOwned } from '../evaluation/PlatformOwned';
import { RunMetadata } from '../evaluation/RunMetadata';
import { acceptsDatasets, acceptsTask, evaluatorFields } from '../model';
import styles from '../evaluation/evaluation.module.css';
import groups from '../settings/settings.module.css';

/** The evaluator inputs that "Where it runs" sets for an environment that accepts datasets and tasks (C172). */
export const SET_IN_WHERE = ['task_name', 'dataset_version', 'dataset_alias'];

/** The inputs people change most, in the open "Common" group (C185); the rest wait under a closed "Advanced". */
export const COMMON_INPUTS = ['samples', 'timeout', 'max_concurrency', 'max_retries'];

/** One collapsible group row of evaluation inputs, the same row as the Environment configurations groups. */
function InputGroup({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className={groups.group} data-input-group={id}>
      <h5 className={groups.groupHead}>
        <button
          type="button"
          className={groups.groupToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(!open)}
        >
          <span className={groups.chevron} data-open={open}>
            <Icon name="chevron-right" size={12} />
          </span>
          <span>{label}</span>
        </button>
      </h5>
      <Collapse open={open} id={bodyId}>
        <div className={groups.groupBody}>{children}</div>
      </Collapse>
    </div>
  );
}

/**
 * Evaluation configurations: the evaluator's inputs on top of the starting point, run metadata,
 * the keys that only Raw JSON or the base carry, and what the platform sets itself. The inputs sit in an open
 * "Common" group and a closed "Advanced" group (C185); Advanced opens by itself while one of its inputs is changed
 * or invalid. In the launch wizard (`inWizard`), when every ticked environment accepts datasets and tasks, step 1
 * sets the task and the dataset, so their inputs leave this step for one read-only line with an Edit button (C172).
 */
export function EvaluationSection({ inWizard }: { inWizard?: boolean } = {}) {
  const { doc, ctx, flags, revealStep } = useLaunch();
  const envs = doc.environmentIds.map((id) => ctx.envs.find((e) => e.id === id));
  const setInWhere =
    Boolean(inWizard) && envs.length > 0 && envs.every((e) => acceptsDatasets(e) && acceptsTask(e));
  const all = evaluatorFields(doc, ctx);
  const fields = setInWhere ? all.filter((f) => !SET_IN_WHERE.includes(f.name)) : all;
  const moved = all.length !== fields.length;
  const common = fields.filter((f) => COMMON_INPUTS.includes(f.name));
  const advanced = fields.filter((f) => !COMMON_INPUTS.includes(f.name));
  const [commonOpen, setCommonOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(() => advanced.some((f) => f.changed));
  const advancedShown = advancedOpen || advanced.some((f) => f.invalid);
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
            <div className={styles.groups}>
              {common.length ? (
                <InputGroup id="common" label="Common" open={commonOpen} onToggle={setCommonOpen}>
                  <div className={styles.grid}>
                    {common.map((f) => (
                      <FieldControl key={f.name} field={f} />
                    ))}
                  </div>
                </InputGroup>
              ) : null}
              {advanced.length || moved ? (
                <InputGroup id="advanced" label="Advanced" open={advancedShown} onToggle={setAdvancedOpen}>
                  {advanced.length ? (
                    <div className={styles.grid}>
                      {advanced.map((f) => (
                        <FieldControl key={f.name} field={f} />
                      ))}
                    </div>
                  ) : null}
                  {moved ? (
                    <div className={styles.readonlyRow} data-testid="set-in-where">
                      <span>Dataset and task are set in Where it runs.</span>
                      <Button variant="ghost" size="sm" onPress={() => revealStep('where')}>
                        Edit
                      </Button>
                    </div>
                  ) : null}
                </InputGroup>
              ) : null}
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
