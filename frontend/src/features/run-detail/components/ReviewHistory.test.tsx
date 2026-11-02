/**
 * Ported from tests/platform/test_review_workflow_browser.py (review history
 * widget): every transition renders as text, comments are never parsed as
 * HTML, and nothing renders for a run that was never submitted. Since C027 the
 * log opens from the hero's History button; C055 marks a self-approval.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewHistoryEvent } from '../types';

let events: ReviewHistoryEvent[] = [];
vi.mock('@/api/runs', () => ({
  useReviewHistoryQuery: () => ({ data: { run_id: 'r', status: 'APPROVED', events } }),
  exportHtmlUrl: (id: string) => `/runs/${id}/export`,
  runKeys: { all: (id: string) => ['run', id] },
}));

import { ReviewLogList, selfApprovals } from './RunPanels';
import { ReviewLog } from './RunActions';

describe('ReviewHistory', () => {
  beforeEach(() => {
    events = [];
  });

  it('renders every transition as text, comments included', () => {
    events = [
      {
        action: 'submit',
        to_status: 'SUBMITTED',
        actor: { display_name: 'Owner' } as never,
        comment: '',
        at: '2026-09-20T10:00:00Z',
        recorded: true,
      },
      {
        action: 'approve',
        to_status: 'APPROVED',
        actor: { display_name: 'Maya' } as never,
        comment: 'LGTM <img src=x onerror=window.pwned=1>',
        at: '2026-09-20T11:00:00Z',
        recorded: true,
      },
      {
        action: 'unapprove',
        to_status: 'FAILED',
        actor: { email: 'lead@example.com' } as never,
        comment: 'numbers were wrong',
        at: '2026-09-21T09:30:00Z',
        recorded: true,
      },
    ];
    const { container } = render(<ReviewLogList events={events} />);
    const entries = within(screen.getByTestId('review-log')).getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.querySelector('[class*="entryHead"] > :first-child')?.textContent)).toEqual([
      'Submitted',
      'Approved',
      'Approval withdrawn',
    ]);
    expect(entries[1]!.textContent).toContain('Maya');
    expect(entries[1]!.textContent).toContain('LGTM <img src=x onerror=window.pwned=1>');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(container.querySelector('img')).toBeNull();
    expect(entries[2]!.textContent).toContain('lead@example.com');
    expect(entries[2]!.textContent).toContain('returned the run to failed');
    expect(entries[2]!.textContent).toContain('numbers were wrong');
  });

  it('names an unknown actor and flags a reconstructed entry', () => {
    events = [{ action: 'submit', actor: null, comment: '', recorded: false }];
    render(<ReviewLogList events={events} />);
    expect(screen.getByTestId('review-log').textContent).toContain('Unknown user');
    expect(screen.getByText(/Reconstructed from the approval record/)).toBeTruthy();
  });

  it('renders nothing for a run that was never submitted', () => {
    const { container } = render(<ReviewLog runId="r" enabled />);
    expect(container).toBeEmptyDOMElement();
  });

  it('C055: marks an approval by the person who submitted the run', () => {
    events = [
      { action: 'submit', actor: { id: 'u1', display_name: 'Dev' } as never, comment: '' },
      { action: 'approve', actor: { id: 'u1', display_name: 'Dev' } as never, comment: 'ok' },
      { action: 'unapprove', actor: { id: 'u2', display_name: 'Lead' } as never, comment: '' },
      { action: 'approve', actor: { id: 'u2', display_name: 'Lead' } as never, comment: '' },
    ];
    expect([...selfApprovals(events)]).toEqual([1]);
    render(<ReviewLogList events={events} />);
    const entries = within(screen.getByTestId('review-log')).getAllByRole('listitem');
    expect(entries[1]!.textContent).toContain('Self-approved');
    expect(entries[3]!.textContent).not.toContain('Self-approved');
  });
});
