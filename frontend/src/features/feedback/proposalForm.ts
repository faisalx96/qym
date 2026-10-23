/** Edit tracking of the proposal card (spec-e 2.5): what the person changed, the submit label, validity. */
import type { FeedbackComplexity, FeedbackPriority, Proposal } from '@/api/feedback';

export interface ProposalForm {
  title: string;
  description: string;
  priority: FeedbackPriority;
  complexity: FeedbackComplexity;
}

export const PRIORITY_LABEL: Record<FeedbackPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const COMPLEXITY_HELP: Record<FeedbackComplexity, string> = {
  S: 'a day or two',
  M: 'about a week',
  L: 'several weeks',
  XL: 'a project of its own',
};

export function formFromProposal(p: Proposal): ProposalForm {
  return {
    title: p.title,
    description: p.description,
    priority: p.priority.level,
    complexity: p.complexity.level,
  };
}

export function hasDuplicate(p: Proposal): boolean {
  return p.related.some((r) => r.kind === 'duplicate');
}

export function submitLabel(p: Proposal): string {
  return hasDuplicate(p) ? 'Submit as a possible duplicate' : 'Submit request';
}

export interface FormErrors {
  title?: string;
  description?: string;
}

export function validate(form: ProposalForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) errors.title = 'The title cannot be empty.';
  else if (form.title.trim().length > 80) errors.title = 'Up to 80 characters.';
  if (!form.description.trim()) errors.description = 'The description cannot be empty.';
  return errors;
}

export function canSubmit(form: ProposalForm, p: Proposal, busy: boolean): boolean {
  return !busy && !p.superseded && Object.keys(validate(form)).length === 0;
}

/** "You changed it from High." for a priority or complexity the person edited, else null. */
export function changedFrom(form: ProposalForm, p: Proposal, field: 'priority' | 'complexity'): string | null {
  const proposed = p[field].level;
  if (form[field] === proposed) return null;
  return field === 'priority' ? PRIORITY_LABEL[proposed as FeedbackPriority] : String(proposed);
}

export interface Merged {
  form: ProposalForm;
  updated: string[];
}

/**
 * QE-73: a new proposal replaces the card. A text field keeps the person's edit only when the new proposal's
 * field equals the old proposal's (the assistant did not change it); otherwise the new text wins and the field is
 * listed as updated by the assistant. Priority and complexity follow the same rule.
 */
export function mergeProposal(current: ProposalForm, previous: Proposal | null, next: Proposal): Merged {
  const fresh = formFromProposal(next);
  if (!previous) return { form: fresh, updated: [] };
  const old = formFromProposal(previous);
  const form = { ...fresh };
  const updated: string[] = [];
  const labels: Record<keyof ProposalForm, string> = {
    title: 'Title',
    description: 'Description',
    priority: 'Priority',
    complexity: 'Complexity',
  };
  (Object.keys(fresh) as (keyof ProposalForm)[]).forEach((key) => {
    if (old[key] === fresh[key]) {
      (form as unknown as Record<string, string>)[key] = current[key];
    } else {
      updated.push(labels[key]);
    }
  });
  return { form, updated };
}
