import { describe, expect, it } from 'vitest';
import { latencyGate } from './latencyGate';
import { createDocument } from './document';
import { buildLaunchRequest, dryRunKey } from './spec';
import { SecretStore } from './secrets';
import { localErrors, validationItems } from './validation';
import { makeCtx, makeEnv } from './__fixtures__/fixtures';

const envs = [
  { id: 'a', name: 'staging', latencyMinRole: 'member' as const },
  { id: 'b', name: 'production', latencyMinRole: 'manager' as const },
  { id: 'c', name: 'edge', latencyMinRole: 'manager' as const },
];

describe('latencyGate', () => {
  it('lets a manager launch anywhere', () => {
    expect(latencyGate(envs, true, ['b', 'c'])).toEqual({ disabled: false, reason: null, managerOnly: [] });
  });
  it('is open with nothing selected', () => {
    expect(latencyGate(envs, false, [])).toEqual({ disabled: false, reason: null, managerOnly: [] });
  });
  it('is partial when some selected environments need a manager', () => {
    const gate = latencyGate(envs, false, ['a', 'b']);
    expect(gate.disabled).toBe(false);
    expect(gate.managerOnly).toEqual(['production']);
  });
  it('disables with a reason when every selected environment needs a manager, in selection order', () => {
    const gate = latencyGate(envs, false, ['c', 'b']);
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toBe('Only project managers can launch latency-sensitive runs on edge, production.');
  });
  it('ignores ids that are not loaded', () => {
    expect(latencyGate(envs, false, ['zzz']).disabled).toBe(false);
  });
});

describe('latency in the request and the review', () => {
  const prod = makeEnv('b', 'production', { latencyMinRole: 'manager' });
  const doc = createDocument({ environmentIds: ['b'], name: 'x', latencySensitive: true });

  it('sends latency_sensitive only when true', () => {
    const on = buildLaunchRequest(doc, new SecretStore(), { dryRun: true });
    const off = buildLaunchRequest({ ...doc, latencySensitive: false }, new SecretStore(), { dryRun: true });
    expect(on.latency_sensitive).toBe(true);
    expect('latency_sensitive' in off).toBe(false);
    expect(dryRunKey(doc)).not.toBe(dryRunKey({ ...doc, latencySensitive: false }));
  });

  it('is a blocking item for a member on a managers-only environment', () => {
    const items = localErrors(doc, makeCtx({ envs: [prod], isManager: false }));
    const item = items.find((i) => i.pointer === '#latency');
    expect(item?.label).toBe('Latency-sensitive');
    expect(item?.message).toBe('Latency-sensitive runs on production need a project manager');
    expect(localErrors(doc, makeCtx({ envs: [prod], isManager: true })).some((i) => i.pointer === '#latency')).toBe(false);
    expect(
      localErrors({ ...doc, latencySensitive: false }, makeCtx({ envs: [prod], isManager: false })).some(
        (i) => i.pointer === '#latency',
      ),
    ).toBe(false);
  });

  it('shows the server twin of the gate once', () => {
    const ctx = makeCtx({ envs: [prod], isManager: false });
    const message = 'Latency-sensitive runs on production need a project manager';
    const items = validationItems(doc, ctx, { errors: [{ pointer: '/latency_sensitive', message }] });
    expect(items.filter((i) => i.message === message)).toHaveLength(1);
    const alone = validationItems(
      { ...doc, latencySensitive: false },
      ctx,
      { errors: [{ pointer: '/latency_sensitive', message }] },
    );
    expect(alone.find((i) => i.pointer === '#latency')?.label).toBe('Latency-sensitive');
  });
});
