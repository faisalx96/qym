/** Round 3 P6: the header chips, their order, caps and summaries. */
import { describe, expect, it } from 'vitest';
import { CHIP_KEY_MAX, CHIP_VALUE_MAX, clip, headerChip, headerChips, stopReasonLine } from '../heroModel';
import type { Run } from '../../types';

const run = (over: Partial<Run>) => ({ run_id: 'r1', ...over }) as Run;

describe('headerChip', () => {
  it('clips a long key at 20 and a long value at 30 characters and keeps the full text in the title', () => {
    const c = headerChip('k'.repeat(40), 'v'.repeat(80));
    expect(c.label).toHaveLength(CHIP_KEY_MAX);
    expect(c.text).toHaveLength(CHIP_VALUE_MAX);
    expect(c.title).toBe(`${'k'.repeat(40)}: ${'v'.repeat(80)}`);
  });

  it('summarises objects and arrays as one token and keeps the compact JSON in the title', () => {
    expect(headerChip('sampler', { a: 1, b: 2, c: 3 }).text).toBe('{ 3 keys }');
    expect(headerChip('xs', [1, 2, 3, 4]).text).toBe('[ 4 items ]');
    expect(headerChip('one', { a: 1 }).text).toBe('{ 1 key }');
    expect(headerChip('s', '{"a":1}').text).toBe('{ 1 key }');
    expect(headerChip('sampler', { a: 1 }).title).toBe('sampler: {"a":1}');
  });

  it('clip leaves short text alone', () => {
    expect(clip('abc', 5)).toBe('abc');
  });
});

describe('headerChips', () => {
  it('orders the groups Versioning, Config, Metadata, versioning keys sorted, git last in its group', () => {
    const groups = headerChips(
      run({
        versioning_details: { prompt: 'v7', model_tag: '2026-09' },
        git_branch: 'main',
        git_commit: 'a1b2c3d',
        config: { temperature: 0.2, max_tokens: 512 },
        metadata: { run_name: 'x', environment: 'staging' },
      }),
    );
    expect(groups.map((g) => g.label)).toEqual(['Versioning', 'Config', 'Metadata']);
    expect(groups[0]!.chips.map((c) => c.key)).toEqual(['model_tag', 'prompt', 'git']);
    expect(groups[0]!.chips.at(-1)!.text).toBe('main • a1b2c3d');
    expect(groups[1]!.chips.map((c) => c.key)).toEqual(['temperature', 'max_tokens']);
  });

  it('a run with nothing to show has no groups (no band 3)', () => {
    expect(headerChips(run({}))).toEqual([]);
  });
});

describe('stopReasonLine', () => {
  it('shows a reason for a stopped or failed run only', () => {
    expect(stopReasonLine(run({ status: 'STOPPED', status_reason_label: 'Stopped by user' }))?.text).toBe(
      'Stopped: Stopped by user',
    );
    expect(stopReasonLine(run({ status: 'FAILED', status_reason_label: 'boom' }))?.danger).toBe(true);
    expect(stopReasonLine(run({ status: 'COMPLETED', status_reason_label: 'x' }))).toBeNull();
    expect(stopReasonLine(run({ status: 'STOPPED' }))).toBeNull();
  });
});
