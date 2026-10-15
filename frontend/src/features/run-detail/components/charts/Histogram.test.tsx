/** Round 3 P1: the bar plot renders a count node per non-empty bucket, count before bar, and the boolean bars are buttons. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BoolSegment, ScoreBucket } from '../../lib/overviewModel';
import { BoolBars, Histogram, PassCountBars } from './Charts';

const bucket = (index: number, count: number, extra: Partial<ScoreBucket> = {}): ScoreBucket => ({
  index,
  label: `${index * 10}%`,
  min: index / 10,
  max: (index + 1) / 10,
  count,
  scorerErrors: 0,
  taskErrors: 0,
  note: '',
  ...extra,
});

describe('Histogram', () => {
  const buckets = [bucket(0, 7), bucket(1, 0), bucket(2, 3, { taskErrors: 1 })];

  it('renders one count node per bucket, before its bar, text drawn from data-text', () => {
    const { container } = render(
      <Histogram buckets={buckets} direction="maximize" metric="q" onPick={() => {}} />,
    );
    const cols = container.querySelectorAll('[data-zero], [data-empty], button');
    expect(container.querySelectorAll('[data-text]').length).toBeGreaterThan(0);
    const first = container.querySelector('button[data-bucket="0"]')!;
    const kids = [...first.children];
    expect(kids[0]!.getAttribute('data-text')).toBe('7');
    expect(kids[1]!.className).toMatch(/bar/);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('draws no count for an empty bucket and makes only non-empty buckets buttons', () => {
    const { container } = render(
      <Histogram buckets={buckets} direction="maximize" metric="q" onPick={() => {}} />,
    );
    expect(container.querySelectorAll('button[data-bucket]')).toHaveLength(2);
    const empty = container.querySelector('[data-empty]')!;
    expect(empty.children[0]!.getAttribute('data-text')).toBe('');
  });

  it('sets --p on each column to count / max', () => {
    const { container } = render(
      <Histogram buckets={buckets} direction="maximize" metric="q" onPick={() => {}} />,
    );
    const p = (el: Element) => Number((el as HTMLElement).style.getPropertyValue('--p'));
    expect(p(container.querySelector('button[data-bucket="0"]')!)).toBe(1);
    expect(p(container.querySelector('button[data-bucket="2"]')!)).toBeCloseTo(3 / 7);
  });
});

describe('BoolBars', () => {
  const seg = (
    key: BoolSegment['key'],
    label: string,
    count: number,
    tone: BoolSegment['tone'],
  ): BoolSegment => ({
    key,
    label,
    count,
    title: label,
    tone,
  });

  it('renders Pass, Fail and Error as three buttons with their percentage under the label', () => {
    const { container } = render(
      <BoolBars
        total={237}
        metric="exact_match"
        onPick={() => {}}
        segments={[
          seg('passed', 'Pass', 47, 'pass'),
          seg('failed', 'Fail', 178, 'fail'),
          seg('metric_errors', 'Error', 12, 'error'),
        ]}
      />,
    );
    expect(container.querySelectorAll('button[data-segment]')).toHaveLength(3);
    expect(container.querySelector('button[data-segment="failed"] [data-text="75%"]')).not.toBeNull();
    expect(container.querySelector('[aria-label$="pass and fail split"]')).not.toBeNull();
  });

  it('prints 0 for an empty pass/fail column (nobody always fails is information)', () => {
    const { container } = render(
      <BoolBars
        total={10}
        metric="m"
        onPick={() => {}}
        segments={[seg('passed', 'Pass', 10, 'pass'), seg('failed', 'Fail', 0, 'fail')]}
      />,
    );
    const fail = container.querySelector('[data-segment="failed"]')!;
    expect(fail.children[0]!.getAttribute('data-text')).toBe('0');
    expect(fail).toBeDisabled();
  });
});

describe('PassCountBars', () => {
  it('prints every count including zeros and labels the bars 0..k', () => {
    const { container } = render(
      <PassCountBars counts={[0, 2, 5]} total={2} selected={null} onPick={() => {}} />,
    );
    const texts = [...container.querySelectorAll('[data-text]')].map((n) => n.getAttribute('data-text'));
    expect(texts).toEqual(['0', '0', '2', '1', '5', '2']);
  });
});
