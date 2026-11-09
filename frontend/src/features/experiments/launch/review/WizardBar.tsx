import { ActionTile, Button, DropdownMenu, Icon } from '@/ui';
import { useMediaQuery } from '@/features/shell';
import { plural } from '../../lib/format';
import { launchLabel } from '../model';
import { useLaunch } from '../LaunchContext';
import { stepLabel, type WizardStepId } from '../wizard/steps';
import styles from './review.module.css';

/**
 * The wizard's one bottom bar, under both columns on every step (C171): Back on the left (disabled on the first
 * step, so the bar keeps its shape), the run count and the first problem, then Skip, Continue and "Launch N runs"
 * on the right, always in the same place. Continue only moves to the next step, so it is neutral; Launch is the
 * one primary button. Cancel joins the bar only where the review pane is folded under the step (`showCancel`);
 * on a phone the problem link and Cancel move into the bar's overflow menu.
 */
export function WizardBar({
  step,
  next,
  prev,
  onGo,
  onCancel,
  showCancel,
}: {
  step: WizardStepId;
  next: WizardStepId | null;
  prev: WizardStepId | null;
  onGo: (step: WizardStepId) => void;
  onCancel: () => void;
  showCancel: boolean;
}) {
  const { review, isLaunching, launch, focusIssue, readOnly } = useLaunch();
  const phone = useMediaQuery('(max-width: 760px)');
  const first = review.items[0];
  const optional = step === 'models' || step === 'settings' || step === 'evaluation';
  const problem = first ? `Fix ${plural(review.items.length, 'problem')} first: ${first.label}` : '';
  const overflow = [
    ...(phone && first ? [{ id: 'problem', label: problem, icon: <ActionTile icon="warning" /> }] : []),
    ...(phone && showCancel ? [{ id: 'cancel', label: 'Cancel', icon: <ActionTile icon="close" /> }] : []),
  ];
  return (
    <div className={styles.wizardBar} role="region" aria-label="Launch">
      <nav className={styles.wizardNav} aria-label="Step navigation">
        <Button
          size="sm"
          variant="neutral"
          isDisabled={!prev}
          onPress={() => (prev ? onGo(prev) : undefined)}
        >
          Back
        </Button>
      </nav>
      <div className={styles.wizardStatus}>
        <span className={styles.barTitle} aria-live="polite" data-compact="">
          {plural(review.count.runs, 'run')} to launch
        </span>
        {!phone && first ? (
          <button type="button" className={styles.problemLink} onClick={() => focusIssue(first)}>
            {problem}
          </button>
        ) : null}
        {!first && !phone ? <span className={styles.ok}>{review.status || 'Ready'}</span> : null}
      </div>
      <div className={styles.wizardActions}>
        {optional ? (
          <Button size="sm" variant="neutral" aria-label="Skip to review" onPress={() => onGo('review')}>
            Skip<span className={styles.long}> to review</span>
          </Button>
        ) : null}
        {next ? (
          <Button
            size="sm"
            variant="neutral"
            aria-label={`Continue to ${stepLabel(next).toLowerCase()}`}
            onPress={() => onGo(next)}
          >
            Continue<span className={styles.long}>{` to ${stepLabel(next).toLowerCase()}`}</span>
          </Button>
        ) : null}
        {overflow.length ? (
          <DropdownMenu
            label="More launch options"
            trigger={
              <Button size="sm" variant="neutral" icon={<Icon name="more" size={14} />}>
                Actions
              </Button>
            }
            items={overflow}
            onAction={(id) => {
              if (id === 'problem' && first) focusIssue(first);
              else if (id === 'cancel') onCancel();
            }}
          />
        ) : null}
        {showCancel && !phone ? (
          <Button size="sm" variant="neutral" onPress={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="primary"
          loading={isLaunching}
          isDisabled={readOnly || !review.canLaunch || review.items.length > 0}
          disabledReason={review.items.length > 0 ? 'Fix the problems first' : undefined}
          onPress={() => void launch()}
        >
          {launchLabel(review.count.runs, isLaunching)}
        </Button>
      </div>
    </div>
  );
}
