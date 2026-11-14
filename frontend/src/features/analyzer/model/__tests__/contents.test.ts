import { describe, expect, it } from 'vitest';
import { CONTENT_SWITCHES, peekKeys, sectionNotes } from '../contents';
import { buildConfigPayload, defaultSettings, fieldsSent } from '../settings';

const base = () => defaultSettings({ metrics: ['accuracy', 'format'], maxIssues: 3, timeoutSeconds: 120 });
const trees = {
  std: { input: [], expected: [], output: [] },
  custom: {},
  metadata: [
    { metric: 'accuracy', paths: ['judge', 'reason'] },
    { metric: 'format', paths: ['reason', 'rule'] },
  ],
};

describe('Prompt contents switches (cv5 Q4): one switch, one section, one name', () => {
  it('each switch sends its own flag; there is no Error switch', () => {
    expect(CONTENT_SWITCHES.map((c) => c.label)).toEqual([
      'Metric result',
      'Metric metadata',
      'Item metadata',
      'Trace evidence',
      'Analysis rules',
      'Reference documents',
    ]);
    const off = { ...base(), includeMetricMetadata: false };
    const cfg = buildConfigPayload(off, trees);
    expect(cfg.include_fields).toMatchObject({ metric_metadata: false, metadata: true, scores: true });
    expect(cfg.metadata_fields).toBeUndefined();
    const item = buildConfigPayload({ ...base(), includeMetadata: false }, trees);
    expect(item.include_fields).toMatchObject({ metric_metadata: true, metadata: false });
    expect(fieldsSent(cfg)).toEqual(['Input', 'Expected', 'Output', 'Metric result', 'Item metadata', 'Trace evidence']);
  });

  it('chosen metric metadata keys are relative to each target metric, never another metric', () => {
    const cfg = buildConfigPayload({ ...base(), metaDeselected: ['reason'] }, trees);
    expect(cfg.metadata_fields).toEqual(['metric_metadata.judge', 'metric_metadata.rule']);
    expect(cfg.metadata_fields?.some((f) => f.startsWith('metric_metadata:'))).toBe(false);
  });

  it('the outline names what is not sent; hover marks the section that the switch sends', () => {
    const s = { ...base(), useTrace: false };
    expect(sectionNotes(s).find((n) => n.key === 'TRACE EVIDENCE')?.state).toBe('off');
    expect(sectionNotes(s).find((n) => n.key === 'ITEM METADATA')?.state).toBe('empty');
    // all metadata keys: the metadata is part of the metric result, so no section of its own is expected
    expect(sectionNotes(s).some((n) => n.key === 'SELECTED METRIC METADATA')).toBe(false);
    expect(peekKeys('metricMeta', s)).toEqual(['SELECTED METRIC RESULT']);
    expect(peekKeys('metricMeta', { ...s, metaDeselected: ['reason'] })).toContain('SELECTED METRIC METADATA');
    expect(peekKeys('docs', s)).toEqual(['REFERENCE DOCUMENTS']);
  });
});
