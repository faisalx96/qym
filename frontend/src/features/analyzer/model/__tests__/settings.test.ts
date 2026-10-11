import { describe, expect, it } from 'vitest';
import { analyzeRequest, buildConfigPayload, defaultSettings, fieldsSent, type FieldTrees } from '../settings';
import { pathsToTree } from '../mapping';

const trees = (extra: Partial<FieldTrees> = {}): FieldTrees => ({
  std: { input: pathsToTree(['q', 'ctx']), expected: [], output: [] },
  custom: {},
  metadata: [],
  ...extra,
});

const base = () => defaultSettings({ metrics: ['a', 'b'], maxIssues: 3, timeoutSeconds: 120 });

describe('buildConfigPayload', () => {
  it('sends include flags and omits mappings at their defaults', () => {
    const cfg = buildConfigPayload(base(), trees());
    expect(cfg.field_mapping).toBeUndefined();
    expect(cfg.custom_variable_mapping).toBeUndefined();
    expect(cfg.additional_instructions).toBeUndefined();
    expect(cfg.include_fields).toMatchObject({ input: true, error: true, trace: true });
    expect(fieldsSent(cfg)).toContain('Trace');
  });

  it('includes a custom field mapping and {var} mapping', () => {
    const s = base();
    s.instructions = ' check {rubric} ';
    s.std.input = { field: 'input', full: false, selected: ['q'] };
    s.custom.rubric = { field: 'expected', full: true, selected: [] };
    const cfg = buildConfigPayload(s, trees());
    expect(cfg.additional_instructions).toBe('check {rubric}');
    expect(cfg.field_mapping).toEqual({ input: ['input.q'], expected: 'expected', output: 'output' });
    expect(cfg.custom_variable_mapping).toEqual({ rubric: 'expected' });
  });

  it('ignores mappings of variables no longer typed', () => {
    const s = base();
    s.custom.gone = { field: 'input', full: true, selected: [] };
    expect(buildConfigPayload(s, trees()).custom_variable_mapping).toBeUndefined();
  });
});

describe('analyzeRequest', () => {
  it('maps the settings to the job body', () => {
    const s = { ...base(), maxScorePct: 60, skipAnalyzed: false, limit: 5 };
    const req = analyzeRequest({}, s, { connectionId: 'c1', pass_number: 2, expected_pass_version: 4 });
    expect(req).toMatchObject({
      metrics: ['a', 'b'],
      max_score: 0.6,
      only_unanalyzed: false,
      limit: 5,
      pass_number: 2,
      expected_pass_version: 4,
      connection_id: 'c1',
      item_filter: 'failed',
    });
  });
});
