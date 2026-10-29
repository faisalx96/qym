/**
 * One-line selection cluster: "N selected · Compare · Cohort · Submit · Delete · Clear · Done selecting" + live guidance.
 * Round 10: every action is a visible button at rest (no ghost), each with its icon; the ready action is the green one
 * (Compare, then Open Cohort once B balances A); Done selecting sits with the actions instead of across the toolbar.
 */
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
  /** Untick everything (select mode stays on). */
  onClear: () => void;
  /** Drop Cohort A and the B picks (select mode stays on). */
  onCancelCohort: () => void;
  /** Leave select mode (the picks are cleared). */
  onDone: () => void;
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
      {cohortMode ? (
        // the two sides at a glance: A is locked (lock glyph), B counts toward A and turns green when it balances
        <span className={styles.cohorts}>
          <span className={styles.side} data-side="a">
            <Icon name="lock" size={12} />
            Cohort A · {p.cohortAUnits} locked
          </span>
          <span className={styles.side} data-side="b" data-ready={cohort.valid ? '' : undefined}>
            Cohort B · {n}/{p.cohortAUnits}
          </span>
        </span>
      ) : (
        <Text variant="sm" as="span" tone={n ? 'primary' : 'muted'} weight={600} className={styles.count}>
          {`${n} ${n === 1 ? 'execution' : 'executions'} selected`}
        </Text>
      )}
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
      <Button
        variant={cohortMode ? 'accent' : 'neutral'}
        onPress={p.onCohort}
        isDisabled={cohortMode ? !cohort.valid : n < 1}
        icon={<Icon name="split" size={12} />}
      >
        {cohortMode ? 'Open Cohort' : 'Cohort'}
      </Button>
      {!p.readOnly && !cohortMode ? (
        <>
          {p.canSubmit ? (
            <Button
              variant="neutral"
              isDisabled={n < 1}
              onPress={p.onSubmit}
              icon={<Icon name="send" size={12} />}
            >
              Submit
            </Button>
          ) : null}
          <Button
            variant="danger"
            isDisabled={n < 1 || !p.canDelete}
            onPress={p.onDelete}
            icon={<Icon name="trash" size={12} />}
          >
            Delete
          </Button>
        </>
      ) : null}
      {cohortMode ? (
        <Button variant="neutral" onPress={p.onCancelCohort} icon={<Icon name="close" size={12} />}>
          Cancel Cohort
        </Button>
      ) : n ? (
        <Button variant="neutral" onPress={p.onClear} icon={<Icon name="close" size={12} />}>
          Clear
        </Button>
      ) : null}
      <span className={styles.divider} aria-hidden="true" />
      <Button variant="neutral" onPress={p.onDone} aria-pressed>
        Done selecting
      </Button>
      <Text variant="sm" tone="muted" as="span" aria-live="polite" className={styles.guidance}>
        {guidance}
      </Text>
    </div>
  );
}
