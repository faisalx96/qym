import { describe, expect, it } from 'vitest';
import {
  evaluatorPanel,
  formResponse,
  makeCtx,
  PRODUCTION,
  slotsResponse,
  twoEnvCtx,
} from './__fixtures__/fixtures';

describe('fixtures', () => {
  it('carry the real exp-seed payloads', () => {
    expect(Object.keys(formResponse.descriptor.fields)).toContain(
      '/LLM_OVERRIDES/endpoints/{endpoint}/model',
    );
    expect(slotsResponse.slots.map((s) => s.slot_key)).toEqual(['endpoint:primary', 'flat:VIZ_LLM']);
    expect(evaluatorPanel.fields).toContain('samples');
  });

  it('build a one- and two-environment context', () => {
    const one = makeCtx();
    expect(one.union.envs).toEqual([PRODUCTION]);
    expect(one.slots.map((s) => s.slot_key)).toEqual(['endpoint:primary', 'flat:VIZ_LLM']);
    const two = twoEnvCtx();
    expect(two.union.presence['/VIZ_MAX_GROUPS']).toEqual([PRODUCTION]);
    expect(two.union.fields['/STAGING_ONLY_FLAG']).toBeDefined();
  });
});
