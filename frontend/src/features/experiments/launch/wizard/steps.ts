/** The wizard's steps: URL ids, labels (legacy copy), and the mapping from sections and review items. */
import type { ValidationItem } from '../model';
import { PSEUDO } from '../model';
import { sectionOfItem, type SectionId } from '../types';

export const WIZARD_STEPS = [
  { id: 'where', label: 'Where it runs' },
  { id: 'start', label: 'Starting point' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Environment configurations' },
  { id: 'evaluation', label: 'Evaluation configurations' },
  { id: 'review', label: 'Review and launch' },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

export interface WizardStepDef {
  readonly id: WizardStepId;
  readonly label: string;
}

/**
 * The preset editor's steps (decision: the editor is the Customize wizard in another mode). The ids are the
 * wizard's, so `stepOfItem`, `useStep` and `?step=` work unchanged; only the first and the last differ in content.
 */
export const EDITOR_STEPS: readonly WizardStepDef[] = [
  { id: 'where', label: 'Environment and dataset' },
  { id: 'models', label: 'Models' },
  { id: 'settings', label: 'Environment configurations' },
  { id: 'evaluation', label: 'Evaluation configurations' },
  { id: 'review', label: 'Review and publish' },
];

export const STEP_IDS: readonly WizardStepId[] = WIZARD_STEPS.map((s) => s.id);

export const stepLabel = (id: WizardStepId, steps: readonly WizardStepDef[] = WIZARD_STEPS): string =>
  steps.find((s) => s.id === id)?.label ?? id;

/** `?step=` value -> step. Missing -> null (the home view); one the step list does not have -> `where`. */
export function parseStep(
  value: string | null,
  ids: readonly WizardStepId[] = STEP_IDS,
): WizardStepId | null {
  if (value === null) return null;
  return (ids as readonly string[]).includes(value) ? (value as WizardStepId) : 'where';
}

export function stepOfSection(id: SectionId): WizardStepId {
  switch (id) {
    case 'models':
      return 'models';
    case 'settings':
    case 'sweeps':
      return 'settings';
    case 'evaluation':
      return 'evaluation';
    default:
      return 'review';
  }
}

/** The step that holds the field of a review item. */
export function stepOfItem(item: ValidationItem): WizardStepId {
  const section = sectionOfItem(item);
  if (section) return stepOfSection(section);
  if (item.stepId === 'start') return 'start';
  if (item.stepId === 'review') return 'review';
  return 'where';
}

/** Fields the home view holds: name, environments, datasets (versions, run shape), tasks, starting point. */
export function heldOnHome(item: ValidationItem): boolean {
  const p = item.pointer;
  return (
    p === PSEUDO.name ||
    p === PSEUDO.environments ||
    p === PSEUDO.latency ||
    p === PSEUDO.base ||
    p === '/evaluator/dataset' ||
    p === '/evaluator/dataset_version' ||
    p === '/evaluator/datasets' ||
    p.startsWith('/evaluator/datasets/') ||
    p === '/evaluator/run_shape' ||
    p === '/evaluator/task' ||
    p.startsWith('/evaluator/task/')
  );
}

/** A request to bring a step on screen (from a clicked problem, an Edit link, "open Raw JSON"). */
export type RevealStep = (step: WizardStepId, opts?: { home?: boolean }) => void;
