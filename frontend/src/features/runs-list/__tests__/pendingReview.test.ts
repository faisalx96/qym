import { describe, expect, it } from 'vitest';
import type { PendingCorrection } from '@/api/dashboardTypes';
import { pendingIssue } from '../pendingReview';

const c = (p: Partial<PendingCorrection>) => ({ id: '9', ...p }) as PendingCorrection;

describe('pendingIssue (C068)', () => {
  it('takes the first human issue, else the first AI issue', () => {
    expect(
      pendingIssue(
        c({
          human_root_cause_issues: [{ category: 'Knowledge Gap', finding: 'Old refund policy' }],
          ai_root_cause_issues: [{ category: 'Hallucination', finding: 'Made-up date' }],
        }),
      ),
    ).toEqual({ category: 'Knowledge Gap', finding: 'Old refund policy' });
    expect(
      pendingIssue(
        c({
          human_root_cause_issues: [],
          ai_root_cause_issues: [{ category: 'Hallucination', finding: 'x' }],
        }),
      ),
    ).toEqual({ category: 'Hallucination', finding: 'x' });
  });

  it('falls back to a legacy root cause, then to nothing', () => {
    expect(pendingIssue(c({ ai_root_cause: 'Retrieval miss' }))).toEqual({
      category: 'Retrieval miss',
      finding: '',
    });
    expect(pendingIssue(c({}))).toBeNull();
  });
});
