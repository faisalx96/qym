import type { PendingCorrection } from '@/api/dashboardTypes';

/**
 * What a pending review is about (C068): its first issue as 'category · finding', from the human issues, or from the AI
 * issues when there are none. A bare legacy root cause stands in for the category.
 */
export function pendingIssue(c: PendingCorrection): { category: string; finding: string } | null {
  for (const list of [c.human_root_cause_issues, c.ai_root_cause_issues]) {
    const first = (list ?? []).find((i) => i.category || i.finding);
    if (first) return { category: first.category ?? '', finding: first.finding ?? '' };
  }
  const legacy = c.human_root_cause || c.ai_root_cause;
  return legacy ? { category: String(legacy), finding: '' } : null;
}
