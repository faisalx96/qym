/** One-line selection cluster: "N selected · Compare · Cohort · Submit · Delete · Clear" + live guidance. */
import { Button, Icon, Text } from '@/ui';
import styles from './SelectionBar.module.css';

export interface SelectionBarProps {
  /** Executions currently ticked (a repeat run counts k). */
  count: number;
  cohortA: string[];
  /** Executions held by the locked Cohort A. */
  cohortAUnits: number;
  /** A tick is already in Cohort A. */
  cohortOverlap: boolean;
  readOnly: boolean;
  /** Every picked run can be submitted (owner or manager, COMPLETED/FAILED/REJECTED). */
  canSubmit: boolean;
  /** Every pick can be deleted by this user (ownership, pass rules). */
  canDelete: boolean;
  onCompare: () => void;
  onCohort: () => void;
  onSubmit: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Guidance for the cohort picker: "Select k more", "Remove k", overlap, "Balanced: n vs n". */
export function cohortGuidance(ua: number, ub: number, overlap: boolean): { text: string; valid: boolean } {
  if (ub === 0) return { text: `Select ${ua} executions for Cohort B.`, valid: false };
  if (ub < ua) return { text: `Select ${ua - ub} more`, valid: false };
  if (ub > ua) return { text: `Remove ${ub - ua}`, valid: false };
  if (overlap) return { text: 'Cohort B cannot include runs already in Cohort A.', valid: false };
  return { text: `Balanced: ${ua} vs ${ub}`, valid: true };
}

export function SelectionBar(p: SelectionBarProps) {
  const n = p.count;
  const cohortMode = p.cohortA.length > 0;
  const cohort = cohortGuidance(p.cohortAUnits, n, p.cohortOverlap);
  const guidance = cohortMode
    ? cohort.text
    : n === 0
      ? 'Tick runs or press x on a focused row.'
      : n === 1
        ? 'Pick one more to compare.'
        : 'Compare opens the runs side by side.';
  return (
    <div className={styles.actions} role="group" aria-label="Selection actions" data-testid="selection-bar">
      <Text variant="sm" as="span" tone={n ? 'primary' : 'muted'} weight={600} className={styles.count}>
        {cohortMode
          ? `Cohort B ${n}/${p.cohortAUnits} ${p.cohortAUnits === 1 ? 'execution' : 'executions'}`
          : `${n} ${n === 1 ? 'execution' : 'executions'} selected`}
      </Text>
      {cohortMode ? null : (
        <Button
          variant="accent"
          onPress={p.onCompare}
          isDisabled={n < 2}
          icon={<Icon name="grid" size={12} />}
        >
          Compare
        </Button>
      )}
      <Button variant="neutral" onPress={p.onCohort} isDisabled={cohortMode ? !cohort.valid : n < 1}>
        {cohortMode ? 'Open Cohort' : 'Cohort'}
      </Button>
      {!p.readOnly && !cohortMode ? (
        <>
          {p.canSubmit ? (
            <Button variant="neutral" isDisabled={n < 1} onPress={p.onSubmit}>
              Submit
            </Button>
          ) : null}
          <Button variant="danger" isDisabled={n < 1 || !p.canDelete} onPress={p.onDelete}>
            Delete
          </Button>
        </>
      ) : null}
      <Button variant="ghost" onPress={p.onClear}>
        {cohortMode ? 'Cancel Cohort' : n ? 'Clear' : 'Done'}
      </Button>
      <Text variant="sm" tone="muted" as="span" aria-live="polite" className={styles.guidance}>
        {cohortMode ? `Cohort A locked (${p.cohortA.length}). ` : ''}
        {guidance}
      </Text>
    </div>
  );
}
