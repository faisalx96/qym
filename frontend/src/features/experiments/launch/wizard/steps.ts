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

export const STEP_IDS: readonly WizardStepId[] = WIZARD_STEPS.map((s) => s.id);

export const stepLabel = (id: WizardStepId): string => WIZARD_STEPS.find((s) => s.id === id)!.label;

/** `?step=` value -> step. Missing -> null (the home view); unknown -> `where`. */
export function parseStep(value: string | null): WizardStepId | null {
  if (value === null) return null;
  return (STEP_IDS as readonly string[]).includes(value) ? (value as WizardStepId) : 'where';
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

/** Fields the home view holds: name, environments, dataset (and version), starting point. */
export function heldOnHome(item: ValidationItem): boolean {
  const p = item.pointer;
  return (
    p === PSEUDO.name ||
    p === PSEUDO.environments ||
    p === PSEUDO.latency ||
    p === PSEUDO.base ||
    p === '/evaluator/dataset' ||
    p === '/evaluator/dataset_version'
  );
}

/** A request to bring a step on screen (from a clicked problem, an Edit link, "open Raw JSON"). */
export type RevealStep = (step: WizardStepId, opts?: { home?: boolean }) => void;
