import { describe, expect, it } from 'vitest';
import type { PresetVersion, RemapResult } from '@/api/evalEnvironments';
import { canRunDefaultPreset, launchBlocker } from '../runDefaultPreset';
import type { EvalEnvironment } from '@/api/evalCommon';

const version = (warnings: PresetVersion['warnings'] = []): PresetVersion => ({
  id: 'v1id',
  preset_id: 'p',
  version: 3,
  schema_id: 's',
  schema_hash: 'h',
  schema_current: true,
  config: {},
  notes: null,
  warnings,
  published_at: '2026-01-01T00:00:00Z',
});
const remap = (over: Partial<RemapResult> = {}): RemapResult => ({
  config: {
    evaluator: { dataset: 'golden' },
    slot_bindings: { 'endpoint:primary': { connection_id: 'c1' } },
  },
  dropped: [],
  errors: [],
  ok: true,
  ...over,
});

describe('launchBlocker (one-click default preset preflight)', () => {
  it('lets a clean version launch', () => {
    expect(launchBlocker('staging', version(), remap())).toBeNull();
  });
  it('blocks on remap errors or a missing remap', () => {
    expect(launchBlocker('staging', version(), remap({ errors: [{ message: 'x' }] }))).toMatch(
      /needs changes/,
    );
    expect(launchBlocker('staging', version(), remap({ ok: false }))).toMatch(/needs changes/);
    expect(launchBlocker('staging', version(), null)).toMatch(/needs changes/);
  });
  it('blocks without a dataset', () => {
    expect(launchBlocker('staging', version(), remap({ config: { evaluator: {} } }))).toMatch(/dataset/);
  });
  it('blocks on a temporary model', () => {
    const r = remap({
      config: { evaluator: { dataset: 'g' }, slot_bindings: { a: { temporary: { model: 'm' } } } },
    });
    expect(launchBlocker('staging', version(), r)).toMatch(/temporary model/);
  });
  it('blocks on an unavailable connection warning', () => {
    expect(
      launchBlocker('staging', version([{ rule: 'connection_missing', message: 'Model gone' }]), remap()),
    ).toBe('Model gone');
  });
});

describe('canRunDefaultPreset', () => {
  const env = {
    is_active: true,
    current_schema_id: 's',
    official_preset_id: 'p',
    official_preset_version: 1,
  } as EvalEnvironment;
  it('needs an active env with a schema and a published default', () => {
    expect(canRunDefaultPreset(env)).toBe(true);
    expect(canRunDefaultPreset({ ...env, is_active: false })).toBe(false);
    expect(canRunDefaultPreset({ ...env, official_preset_version: null })).toBe(false);
    expect(canRunDefaultPreset(null)).toBe(false);
  });
});
