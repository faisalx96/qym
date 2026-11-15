/** The pure parts of the item pane model: the pass-if text, the prompt line, the reason, the first failed pass. */
import { describe, expect, it } from 'vitest';
import type { Row } from '../../../../types';
import {
  analysisWarnings,
  editTooltip,
  extraMeta,
  firstBadPass,
  passIfText,
  promptLine,
  reasonOf,
  type ItemPass,
} from '../model';

describe('passIfText', () => {
  it('writes a score threshold as a percentage with the direction sign', () => {
    expect(passIfText('score', 0.7, 'maximize')).toBe('≥70%');
    expect(passIfText('score', 0.25, 'minimize')).toBe('≤25%');
    expect(passIfText('boolean', 1, undefined)).toBe('≥100%');
  });
  it('writes a numeric threshold as the number, not as a percentage', () => {
    expect(passIfText('numeric', 3, 'minimize')).toBe('≤ 3');
    expect(passIfText('numeric', 12000, 'maximize')).toBe('≥ 12.0K');
    expect(passIfText('numeric', 0.5, undefined)).toMatch(/^≥ 0\.5/);
  });
});

describe('promptLine', () => {
  it('gives plain text as one line', () => {
    expect(promptLine('How long\n do refunds take?')).toBe('How long do refunds take?');
  });
  it('gives the well-known prompt field of a JSON input, also when it is nested', () => {
    expect(promptLine('{"channel":"chat","message":"My order is late","tier":"gold"}')).toBe(
      'My order is late',
    );
    expect(promptLine({ meta: { id: 1 }, payload: { question: 'Where is it?' } })).toBe('Where is it?');
  });
  it('gives the lone text field of an object', () => {
    expect(promptLine({ anything: 'Only this' })).toBe('Only this');
  });
  it('falls back to the preview of the value when it has no prompt field', () => {
    expect(promptLine({ a: 1, b: 2 })).toBe('a: 1 · b: 2');
  });
});

describe('reasonOf and extraMeta', () => {
  it('takes the first reason key that holds text', () => {
    expect(reasonOf({ explanation: 'Because', label: 'x' })).toBe('Because');
    expect(reasonOf({ reason: '  ', reasoning: 'Second' })).toBe('Second');
    expect(reasonOf({ reason: 'error' })).toBe('');
    expect(reasonOf(undefined)).toBe('');
  });
  it('leaves the reason keys out of the details', () => {
    expect(extraMeta({ reason: 'r', judge: 'gpt', rubric: { a: 1 } })).toEqual({
      judge: 'gpt',
      rubric: { a: 1 },
    });
  });
});

describe('firstBadPass', () => {
  const pass = (n: number, kind: ItemPass['kind']): ItemPass => ({
    pass: n,
    scoped: {} as Row,
    kind,
    label: kind,
    taskError: kind === 'error',
  });
  it('opens on the first pass that did not pass, else on pass 1', () => {
    expect(firstBadPass([pass(1, 'pass'), pass(2, 'fail'), pass(3, 'error')])).toBe(2);
    expect(firstBadPass([pass(1, 'pass'), pass(2, 'pass')])).toBe(1);
  });
});

describe('editTooltip', () => {
  it('names the editor, the change and the scorer value', () => {
    const text = editTooltip({ last_edit: { by: 'sara', from: 0.4, to: 0.9 }, original_score: 0.4 });
    expect(text).toContain('Edited by sara');
    expect(text).toContain('0.4 → 0.9');
    expect(text).toContain('Original score: 0.4');
  });
  it('says so when there is no edit record', () => {
    expect(editTooltip({})).toBe('Edited by a reviewer');
  });
});

describe('analysisWarnings', () => {
  const row = (extra: Partial<Row>) => ({ index: 0, item_id: 'a', status: 'completed', ...extra }) as Row;
  it('collects item and metric warnings once, case-insensitively', () => {
    const r = row({
      item_metadata: {
        analysis_warning: 'No taxonomy',
        metric_analyses: { a: { warning: 'no taxonomy' }, b: { warning: 'Low confidence' } },
      },
    } as Partial<Row>);
    expect(analysisWarnings(r)).toEqual(['No taxonomy', 'Low confidence']);
  });
  it('does not repeat the item warning when an analysis failed', () => {
    const r = row({
      item_metadata: { analysis_warning: 'x', metric_analyses: { a: { error: 'boom', warning: 'y' } } },
    } as Partial<Row>);
    expect(analysisWarnings(r)).toEqual([]);
  });
});
