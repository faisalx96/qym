import { Button, DropdownMenu, IconButton } from '@/ui';
import { useMediaQuery } from '@/features/shell';
import { plural } from '../../lib/format';
import { launchLabel } from '../model';
import { useLaunch } from '../LaunchContext';
import { stepLabel, type WizardStepId } from '../wizard/steps';
import styles from './review.module.css';

/**
 * The wizard's one bottom bar where the review rail gives way (the settings step and every narrow layout): Back,
 * the run count and the first problem, then Skip / Continue / Launch in a single --bar-action-h row. On a phone
 * the problem link and Cancel move into the bar's overflow menu.
 */
export function WizardBar({
  step,
  next,
  prev,
  onGo,
  onCancel,
}: {
  step: WizardStepId;
  next: WizardStepId | null;
  prev: WizardStepId | null;
  onGo: (step: WizardStepId) => void;
  onCancel: () => void;
}) {
  const { review, isLaunching, launch, focusIssue, readOnly } = useLaunch();
  const phone = useMediaQuery('(max-width: 760px)');
  const first = review.items[0];
  const optional = step === 'models' || step === 'settings' || step === 'evaluation';
  const problem = first ? `Fix ${plural(review.items.length, 'problem')} first: ${first.label}` : '';
  return (
    <div className={styles.wizardBar} role="region" aria-label="Launch">
      <nav className={styles.wizardNav} aria-label="Step navigation">
        {prev ? (
          <Button size="sm" variant="neutral" onPress={() => onGo(prev)}>
            Back
          </Button>
        ) : null}
        {optional ? (
          <Button size="sm" variant="neutral" aria-label="Skip to review" onPress={() => onGo('review')}>
            Skip<span className={styles.long}> to review</span>
          </Button>
        ) : null}
        {next ? (
          <Button
            size="sm"
            variant="accent"
            aria-label={`Continue to ${stepLabel(next).toLowerCase()}`}
            onPress={() => onGo(next)}
          >
            Continue<span className={styles.long}>{` to ${stepLabel(next).toLowerCase()}`}</span>
          </Button>
        ) : null}
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
        {phone ? (
          <DropdownMenu
            label="More launch options"
            trigger={<IconButton label="More launch options" icon="more" />}
            items={[...(first ? [{ id: 'problem', label: problem }] : []), { id: 'cancel', label: 'Cancel' }]}
            onAction={(id) => {
              if (id === 'problem' && first) focusIssue(first);
              else if (id === 'cancel') onCancel();
            }}
          />
        ) : (
          <Button size="sm" variant="ghost" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          loading={isLaunching}
          isDisabled={readOnly || !review.canLaunch || review.items.length > 0}
          onPress={() => void launch()}
        >
          {launchLabel(review.count.runs, isLaunching)}
        </Button>
      </div>
    </div>
  );
}
