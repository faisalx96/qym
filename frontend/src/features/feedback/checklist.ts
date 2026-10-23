import type { ChecklistItem, ChecklistState } from '@/api/feedback';

export const STATE_WORD: Record<ChecklistState, string> = {
  filled: 'Known',
  partial: 'Partly known',
  open: 'Not asked yet',
  declined: 'Not known',
};

/** "3 of 6": items the assistant knows or the person declined to answer. */
export function knownCount(items: ChecklistItem[]): number {
  return items.filter((i) => i.state === 'filled' || i.state === 'declined').length;
}

/** The labels of the items still open or partial (the "did not learn" list of QE-74). */
export function gapLabels(items: ChecklistItem[], keys: string[]): string[] {
  return keys.map((k) => items.find((i) => i.key === k)?.label ?? k);
}
