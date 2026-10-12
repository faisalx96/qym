/**
 * Cutover of tests/platform/test_item_reasons.py (item_reasons.js run in Node): the first reason that
 * exists wins in the documented order, and a row asks the server only when the index may hide a
 * better reason.
 */
import { describe, expect, it } from 'vitest';
import { needsServerReason, pickReason, type ReasonInput } from '../itemReasons';

describe('item reasons', () => {
  it('the first reason that exists wins in the documented order', () => {
    const full = {
      status: 'timeout',
      error: 'judge timed out',
      reason: 'rows differ',
      explanation: 'long judge text',
      label: 'mismatch',
    };
    const { status: _status, ...withoutStatus } = full;
    void _status;
    const cases: ReasonInput[] = [
      { taskError: 'boom', meta: full },
      { taskError: true, meta: {} },
      { meta: full },
      { meta: { status: 'failed' } },
      { scorerError: 'Scorer failed in 2 of 3 passes: 429', meta: {} },
      { meta: withoutStatus },
      { meta: { error: 'Empty output', explanation: 'x', label: 'y' } },
      { meta: { explanation: 'long judge text', label: 'y', comparison: { error: 'Result Error' } } },
      { meta: { label: 'mismatch', comparison: { error: 'Result Error' } } },
      // Custom keys (comparison.error) are never parsed.
      { meta: { comparison: { error: 'Result Error' } }, score: 'False', need: 'True' },
      { meta: { status: 'ok', reason: '  ' }, score: '42.0%', need: '≥80%' },
    ];
    expect(cases.map((c) => [pickReason(c).text, pickReason(c).source])).toEqual([
      ['boom', 'task error'],
      ['Task execution failed', 'task error'],
      ['judge timed out', 'scorer error'],
      ['The scorer ended with status failed', 'scorer error'],
      ['Scorer failed in 2 of 3 passes: 429', 'scorer error'],
      ['rows differ', 'reason'],
      ['Empty output', 'reason'],
      ['long judge text', 'explanation'],
      ['mismatch', 'label'],
      ['Scored False, pass needs True', 'no reason recorded'],
      ['Scored 42.0%, pass needs ≥80%', 'no reason recorded'],
    ]);
  });

  it('rows ask the server only when the index may hide a better reason', () => {
    const keys = ['reason', 'explanation', 'label'];
    const ask = (input: ReasonInput, metaKeys: string[]) => needsServerReason(pickReason(input), metaKeys);
    expect([
      ask({ taskError: 'boom' }, keys),
      ask({ meta: { status: 'error' } }, keys),
      ask({ meta: { reason: 'short' } }, keys),
      // meta.reason outranks a verdict stored under error.
      ask({ meta: { error: 'Empty output' } }, keys),
      ask({ meta: { error: 'Empty output' } }, ['explanation']),
      ask({ meta: { label: 'x' } }, ['explanation']),
      ask({ meta: {} }, ['label']),
      ask({ meta: {} }, []),
    ]).toEqual([false, false, false, true, false, true, false, false]);
  });
});
