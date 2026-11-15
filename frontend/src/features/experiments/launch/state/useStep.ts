/** The wizard step in the URL: `?step=` absent = the home view, present = Customize at that step. */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseStep, WIZARD_STEPS, type WizardStepDef, type WizardStepId } from '../wizard/steps';

/** The params that define a form (a change is a new form); `step` never does. */
export function entryKey(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('step');
  return params.toString();
}

/** `pathname + search` without `step`: what the unsaved-changes guard compares. */
export function locationKey(location: { pathname: string; search: string }): string {
  return `${location.pathname}?${entryKey(location.search)}`;
}

export interface StepApi {
  /** null = home view. */
  step: WizardStepId | null;
  /** Push (default) or replace the URL; `null` returns to the home view. */
  goToStep: (step: WizardStepId | null, opts?: { replace?: boolean }) => void;
  next: WizardStepId | null;
  prev: WizardStepId | null;
}

/**
 * `steps` is the active step list (the wizard's, or the preset editor's); `homeless` = no home view: a missing
 * `?step=` is the first step (the editor opens on it).
 */
export function useStep(steps: readonly WizardStepDef[] = WIZARD_STEPS, homeless = false): StepApi {
  const [params, setParams] = useSearchParams();
  const raw = params.get('step');
  const ids = useMemo(() => steps.map((s) => s.id), [steps]);
  const step = useMemo(() => {
    const parsed = parseStep(raw, ids);
    return parsed ?? (homeless ? (ids[0] ?? 'where') : null);
  }, [raw, ids, homeless]);
  const goToStep = useCallback<StepApi['goToStep']>(
    (target, opts) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (target) out.set('step', target);
          else out.delete('step');
          return out;
        },
        { replace: opts?.replace },
      );
    },
    [setParams],
  );
  const index = step ? ids.indexOf(step) : -1;
  return {
    step,
    goToStep,
    next: index >= 0 ? (steps[index + 1]?.id ?? null) : null,
    prev: index > 0 ? (steps[index - 1]?.id ?? null) : null,
  };
}
