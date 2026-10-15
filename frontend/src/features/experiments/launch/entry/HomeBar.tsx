import { useMemo } from 'react';
import { Button, TextField } from '@/ui';
import { plural } from '../../lib/format';
import { NAME_MAX, PSEUDO, pointerToFieldName } from '../model';
import { useLaunch } from '../LaunchContext';
import { heldOnHome, stepOfItem, type WizardStepId } from '../wizard/steps';
import styles from './entry.module.css';

/** What the home bar's status line says; pure so it can be tested for every state. */
export function homeStatus(args: {
  envCount: number;
  loading: boolean;
  error: string;
  over: boolean;
  problems: number;
  baseLabel: string;
  envNames: string;
}): string {
  if (!args.envCount) return 'Pick an environment.';
  if (args.loading) return 'Checking…';
  if (args.error) return args.error;
  if (args.over) return 'Over the run limit';
  if (args.problems) return `${plural(args.problems, 'problem')} to fix`;
  return `Ready: ${args.baseLabel} on ${args.envNames}`;
}

/**
 * The home view's sticky bar: the experiment name, a status line and the two ways forward,
 * "Launch as is" and "Customize →".
 */
export function HomeBar({ onCustomize }: { onCustomize: (step: WizardStepId) => void }) {
  const {
    doc,
    setDoc,
    review,
    preview,
    selectedEnvs,
    baseState,
    isLaunching,
    launch,
    readOnly,
    registerField,
    focusIssue,
  } = useLaunch();
  const envCount = doc.environmentIds.length;
  const envNames = selectedEnvs.map((e) => e.name).join(', ');
  const status = homeStatus({
    envCount,
    loading: preview.loading || baseState.loading,
    error: preview.error,
    over: review.count.over,
    problems: review.items.length,
    baseLabel: baseState.label,
    envNames,
  });
  const first = review.items[0];
  const showProblems =
    envCount > 0 && !preview.loading && !baseState.loading && !preview.error && review.items.length > 0;
  const suggestion = useMemo(
    () =>
      envCount
        ? [baseState.label, envNames, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ')
        : '',
    [envCount, baseState.label, envNames],
  );
  // "Show" / Customize land on the first step that holds a problem the home view does not.
  const away = review.items.find((item) => !heldOnHome(item));
  return (
    <div className={styles.homeBar} role="region" aria-label="Launch">
      <TextField
        ref={(el) => registerField(pointerToFieldName(PSEUDO.name), el)}
        className={styles.homeName}
        label="Experiment name"
        hideLabel
        placeholder={suggestion}
        value={doc.name}
        maxLength={NAME_MAX}
        isDisabled={readOnly}
        onChange={(name) => setDoc((d) => ({ ...d, name }))}
      />
      <div className={styles.homeStatus}>
        <span role="status" className={styles.homeStatusText} data-tone={showProblems ? 'problem' : 'ok'}>
          {status}
        </span>
        {showProblems && first ? <span className={styles.homeIssue}>{first.message}</span> : null}
        {showProblems && first ? (
          <button type="button" className={styles.homeShow} onClick={() => focusIssue(first)}>
            Show
          </button>
        ) : null}
        {envCount && !review.count.over && !preview.error ? (
          <span className={styles.homeRuns} aria-live="polite">
            {plural(review.count.runs, 'run')} to launch
          </span>
        ) : null}
      </div>
      <div className={styles.homeActions}>
        <Button
          variant="accent"
          loading={isLaunching}
          isDisabled={readOnly || !review.canLaunch || review.items.length > 0 || isLaunching}
          onPress={() => void launch()}
        >
          Launch as is
        </Button>
        <Button variant="neutral" onPress={() => onCustomize(away ? stepOfItem(away) : 'where')}>
          Customize →
        </Button>
      </div>
    </div>
  );
}
