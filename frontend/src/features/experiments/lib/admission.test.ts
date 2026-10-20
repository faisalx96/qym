import { describe, expect, it } from 'vitest';
import { admissionLine, clockTime, type AdmissionJob } from './admission';

const job = (over: Partial<AdmissionJob> = {}): AdmissionJob => ({
  status: 'QUEUED',
  error: null,
  wait_reason: null,
  admitted_at: null,
  deferrals: 0,
  deferral_reason: null,
  contaminated_attempts: 0,
  ...over,
});

describe('admissionLine', () => {
  it('puts the job error first, in red', () => {
    expect(admissionLine(job({ status: 'FAILED', error: 'giving up after 3 discarded run(s)', contaminated_attempts: 3 }))).toEqual({
      text: 'giving up after 3 discarded run(s)',
      error: true,
    });
  });
  it('reads a deferral of a waiting job', () => {
    expect(admissionLine(job({ deferrals: 3, deferral_reason: 'vllm quiet window' }))?.text).toBe(
      'deferred ×3 · vllm quiet window',
    );
    expect(admissionLine(job({ deferrals: 1 }))?.text).toBe('deferred ×1');
  });
  it('does not call a finished or admitted job deferred', () => {
    expect(admissionLine(job({ status: 'SUCCEEDED', deferrals: 2, contaminated_attempts: 1 }))?.text).toBe(
      're-queued ×1 · contaminated',
    );
    const iso = '2026-10-20T12:52:00';
    const running = admissionLine(job({ status: 'RUNNING', deferrals: 2, admitted_at: iso }));
    expect(running?.text).toBe(`admitted ${clockTime(iso)}`);
    expect(running?.title).toBe(iso);
  });
  it('shows re-queues of a waiting job after its deferral text', () => {
    expect(admissionLine(job({ deferrals: 1, deferral_reason: 'gateway quiet window', contaminated_attempts: 1 }))?.text).toBe(
      'deferred ×1 · gateway quiet window',
    );
  });
  it('falls back to the wait reason of a cancellable job, then to nothing', () => {
    expect(admissionLine(job({ wait_reason: 'Queued on the evaluation service' }))?.text).toBe(
      'Queued on the evaluation service',
    );
    expect(admissionLine(job({ status: 'SUCCEEDED', wait_reason: 'x' }))).toBeNull();
  });
  it('keeps an ordinary experiment as it was', () => {
    expect(admissionLine(job({ deferrals: 3, deferral_reason: 'r', contaminated_attempts: 2 }), false)).toBeNull();
    expect(admissionLine(job({ error: 'boom' }), false)).toEqual({ text: 'boom', error: true });
  });
});
