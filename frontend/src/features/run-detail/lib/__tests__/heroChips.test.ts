/** Round 3 P6: the header chips, their order, caps and summaries. */
import { describe, expect, it } from 'vitest';
import { CHIP_KEY_MAX, CHIP_VALUE_MAX, clip, headerChip, headerChips, runNotice } from '../heroModel';
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

describe('runNotice (RF2, C097)', () => {
  it('shows a reason for a stopped or failed run only', () => {
    expect(runNotice(run({ status: 'STOPPED', status_reason_label: 'Stopped by user' }))).toMatchObject({
      tone: 'warning',
      lead: 'Stopped:',
      text: 'Stopped by user',
    });
    expect(runNotice(run({ status: 'FAILED', status_reason_label: 'boom' }))).toMatchObject({
      tone: 'danger',
      lead: 'Failed:',
    });
    expect(runNotice(run({ status: 'COMPLETED', status_reason_label: 'x' }))).toBeNull();
    expect(runNotice(run({ status: 'STOPPED' }))).toBeNull();
  });

  it('a failed run with no reason says what the client reported and how many items errored', () => {
    const errors = { items: 25, total: 100, passes: 35, repeat: true };
    expect(runNotice(run({ status: 'FAILED' }), { errors })).toEqual({
      tone: 'danger',
      lead: 'Failed.',
      text: 'The client reported the run as failed. 25 of 100 items had a task error in at least one pass (35 errored passes).',
      errorsLink: true,
    });
    expect(
      runNotice(run({ status: 'FAILED' }), { errors: { ...errors, repeat: false, passes: 25 } })?.text,
    ).toBe('The client reported the run as failed. 25 of 100 items had a task error.');
    expect(runNotice(run({ status: 'FAILED' }))).toMatchObject({
      text: 'The client reported the run as failed.',
      errorsLink: false,
    });
  });

  it('a stopped run says how much of the dataset it covers', () => {
    const stopped = run({
      status: 'STOPPED',
      status_reason_label: 'No events received for 180s; the run resumes if it sends more',
      metadata: { total_items: 51 },
    });
    expect(runNotice(stopped, { received: 17 })?.text).toBe(
      'No events received for 180s; the run resumes if it sends more. Covers 33% of the dataset (17 of 51 items).',
    );
    expect(runNotice(stopped, { received: 51 })?.text).toBe(
      'No events received for 180s; the run resumes if it sends more',
    );
  });
});
