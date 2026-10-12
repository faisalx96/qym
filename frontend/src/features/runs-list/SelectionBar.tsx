/** One-line selection cluster: "N selected · Compare · Cohort · Submit · Delete · Clear" + live guidance. */
import { Button, Icon, Text } from '@/ui';
import styles from './SelectionBar.module.css';

export interface SelectionBarProps {
  count: number;
  cohortA: string[];
  readOnly: boolean;
  canDelete: boolean;
  onCompare: () => void;
  onCohort: () => void;
  onSubmit: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function SelectionBar(p: SelectionBarProps) {
  const n = p.count;
  const guidance = p.cohortA.length
    ? `Cohort A locked (${p.cohortA.length}). Pick the same number of executions for B, then press Cohort B.`
    : n === 0
      ? 'Tick runs or press x on a focused row.'
      : n === 1
        ? 'Pick one more to compare.'
        : 'Compare opens the runs side by side.';
  return (
    <div className={styles.actions} role="group" aria-label="Selection actions" data-testid="selection-bar">
      <Text variant="sm" as="span" tone={n ? 'primary' : 'muted'} weight={600} className={styles.count}>
        {n} {n === 1 ? 'execution' : 'executions'} selected
      </Text>
      <Button variant="accent" onPress={p.onCompare} isDisabled={n < 2} icon={<Icon name="grid" size={12} />}>
        Compare
      </Button>
      <Button variant="neutral" onPress={p.onCohort} isDisabled={n < 1}>
        {p.cohortA.length ? 'Cohort B →' : 'Cohort'}
      </Button>
      {!p.readOnly ? (
        <>
          <Button variant="neutral" isDisabled={n < 1} onPress={p.onSubmit}>
            Submit
          </Button>
          {p.canDelete ? (
            <Button variant="danger" isDisabled={n < 1} onPress={p.onDelete}>
              Delete
            </Button>
          ) : null}
        </>
      ) : null}
      <Button variant="ghost" onPress={p.onClear}>
        {n ? 'Clear' : 'Done'}
      </Button>
      <Text variant="sm" tone="muted" as="span" aria-live="polite" className={styles.guidance}>
        {guidance}
      </Text>
    </div>
  );
}
