/** Round 5 R3: key humanizing for detail labels. */
import { describe, expect, it } from 'vitest';
import { humanizeKey } from '../humanizeKey';

describe('humanizeKey', () => {
  it('turns snake_case into a sentence', () => {
    expect(humanizeKey('detailed_reasoning_trace')).toBe('Detailed reasoning trace');
    expect(humanizeKey('self_consistency_check_result')).toBe('Self consistency check result');
    expect(humanizeKey('latency_ms')).toBe('Latency ms');
  });

  it('splits camelCase and kebab-case', () => {
    expect(humanizeKey('judgeModel')).toBe('Judge model');
    expect(humanizeKey('top-k')).toBe('Top k');
  });

  it('keeps numbers and inner acronyms, lowers an ALL CAPS key', () => {
    expect(humanizeKey('score_v2')).toBe('Score v2');
    expect(humanizeKey('LLM_judge')).toBe('LLM judge');
    expect(humanizeKey('REASON')).toBe('Reason');
  });

  it('leaves Arabic and empty keys untouched', () => {
    expect(humanizeKey('السبب')).toBe('السبب');
    expect(humanizeKey('')).toBe('');
    expect(humanizeKey('___')).toBe('___');
  });
});
