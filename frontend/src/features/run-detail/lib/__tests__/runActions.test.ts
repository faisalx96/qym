/** Review group R4 (C034, C031, C047): the run header's Actions menu and the reference run. */
import { describe, expect, it } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { compareWithReferenceUrl, pickReferenceRun, runActionItems } from '../runActions';

const owner = { isOwner: true, canManage: false, isAdmin: false, readOnly: false };
const manager = { isOwner: false, canManage: true, isAdmin: false, readOnly: false };
const ids = (status: string, viewer: typeof owner) => runActionItems(status, viewer).map((i) => i.id);

describe('runActionItems', () => {
  it('puts Submit (not "Submit for review") first for the owner of a completed run, Delete last in red', () => {
    const items = runActionItems('COMPLETED', owner);
    expect(items.map((i) => i.label)).toEqual(['Submit', 'Export HTML', 'Delete']);
    expect(items.at(-1)).toMatchObject({ tone: 'danger', separatorBefore: true, icon: 'trash' });
  });

  it('gives a manager the decision for the run state, then Export, Transfer and Delete', () => {
    expect(ids('SUBMITTED', manager)).toEqual(['approve', 'reject', 'export', 'transfer', 'delete']);
    expect(ids('APPROVED', manager)).toEqual(['unapprove', 'export', 'transfer', 'delete']);
  });

  it('C047: a rejected run offers Resubmit first', () => {
    expect(ids('REJECTED', owner)[0]).toBe('resubmit');
    expect(ids('REJECTED', manager)).toEqual(['resubmit', 'unreject', 'export', 'transfer', 'delete']);
  });

  it('a read-only viewer keeps only Export HTML', () => {
    expect(ids('COMPLETED', { ...owner, readOnly: true })).toEqual(['export']);
  });
});

const row = (id: string, status: string, started: string, origin = 'local') =>
  ({
    run_id: id,
    run_name: id,
    status,
    started_at: started,
    timestamp: started,
    origin,
  }) as unknown as RunRow;

describe('pickReferenceRun (C034)', () => {
  const me = { run_id: 'me', started_at: '2026-10-29T10:00:00Z' };

  it('prefers the latest approved run of the same task and dataset', () => {
    const ref = pickReferenceRun(
      [
        row('a1', 'APPROVED', '2026-10-01T00:00:00Z'),
        row('a2', 'APPROVED', '2026-10-20T00:00:00Z'),
        row('o1', 'COMPLETED', '2026-10-25T00:00:00Z', 'official'),
        row('me', 'APPROVED', '2026-10-29T10:00:00Z'),
      ],
      me,
    );
    expect(ref).toMatchObject({ runId: 'a2', kind: 'approved' });
  });

  it('falls back to the latest official run, then to the previous finished run', () => {
    expect(
      pickReferenceRun(
        [
          row('o1', 'COMPLETED', '2026-10-25T00:00:00Z', 'official'),
          row('p', 'COMPLETED', '2026-10-28T00:00:00Z'),
        ],
        me,
      ),
    ).toMatchObject({ runId: 'o1', kind: 'official' });
    expect(
      pickReferenceRun(
        [
          row('p1', 'COMPLETED', '2026-10-27T00:00:00Z'),
          row('p2', 'FAILED', '2026-10-28T00:00:00Z'),
          row('later', 'COMPLETED', '2026-10-30T00:00:00Z'),
        ],
        me,
      ),
    ).toMatchObject({ runId: 'p1', kind: 'previous' });
    expect(pickReferenceRun([row('me', 'COMPLETED', '2026-10-29T10:00:00Z')], me)).toBeNull();
  });

  it('opens Compare with the reference as the baseline', () => {
    expect(compareWithReferenceUrl('/compare', { runId: 'a2', name: 'a2', kind: 'approved' }, 'me')).toBe(
      '/compare?runs=a2&runs=me&baseline=a2',
    );
  });
});
