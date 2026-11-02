/** Copy and rules of the batch confirm dialog (A3-29 to A3-36, A3-41). */
import type { BatchAction } from '@/api/datasets';
import { metaChipLabel, type MetaFilter } from './metaFilter';

/** Typed confirmation is required for deleting more than this many items (A3-34). */
export const DELETE_CONFIRM_THRESHOLD = 50;

export interface BatchCriteria {
  search?: string;
  label?: string;
  meta: MetaFilter[];
  /** set when the batch acts on picked rows instead of a filter */
  selectedCount?: number;
}

/** "domain: finance, source.region.code: sa" (search as `search “x”`, label as `label: x`). */
export function filterSentence(criteria: BatchCriteria): string {
  const parts: string[] = [];
  if (criteria.search) parts.push(`search “${criteria.search}”`);
  if (criteria.label) parts.push(`label: ${criteria.label}`);
  for (const f of criteria.meta) parts.push(metaChipLabel(f));
  return parts.join(', ');
}

const SUFFIX: Record<BatchAction, string> = {
  disable: ' and are active',
  enable: ' and are disabled',
  delete: '',
};

/** "40 of 130 items match domain: finance and are active." or the selected-rows form (A3-41). */
export function batchSentence(
  action: BatchAction,
  criteria: BatchCriteria,
  affected: number,
  total: number,
): string {
  if (criteria.selectedCount !== undefined) {
    return `${affected} of ${criteria.selectedCount} selected items ${action === 'delete' ? 'are in this draft' : action === 'disable' ? 'are active' : 'are disabled'}.`;
  }
  return `${affected} of ${total} items match ${filterSentence(criteria)}${SUFFIX[action]}.`;
}

/** Up to five ids and "and n more" (never negative, A3-30). */
export function sampleIds(sample: readonly string[], affected: number): { ids: string[]; more: number } {
  const ids = sample.slice(0, 5);
  return { ids, more: Math.max(0, affected - ids.length) };
}

export function needsTypedConfirm(action: BatchAction, affected: number): boolean {
  return action === 'delete' && affected > DELETE_CONFIRM_THRESHOLD;
}

/** The delete button is armed when the trimmed text equals the number (A3-34). */
export function typedConfirmMatches(text: string, affected: number): boolean {
  return text.trim() === String(affected);
}

export function batchTitle(action: BatchAction, n: number): string {
  const verb = action === 'disable' ? 'Disable' : action === 'enable' ? 'Enable' : 'Delete';
  return `${verb} ${n} ${n === 1 ? 'item' : 'items'}?`;
}

export function batchButtonLabel(action: BatchAction, n: number): string {
  return `${action === 'disable' ? 'Disable' : action === 'enable' ? 'Enable' : 'Delete'} ${n}`;
}

export function batchToast(action: BatchAction, n: number): string {
  const verb = action === 'disable' ? 'Disabled' : action === 'enable' ? 'Enabled' : 'Deleted';
  return `${verb} ${n} ${n === 1 ? 'item' : 'items'}`;
}

/** Menu entries for "All matching" use the counts of the current criteria (A3-16). */
export function menuLabel(action: BatchAction, n: number): string {
  const verb = action === 'disable' ? 'Disable' : action === 'enable' ? 'Enable' : 'Delete';
  return `${verb} all ${n} matching…`;
}
