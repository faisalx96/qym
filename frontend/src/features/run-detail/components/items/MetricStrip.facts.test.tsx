/**
 * Round 7, D2: the facts of a metric's detail panel show each judge key as written, wrapped in its column; the label of a
 * prose block is the one eyebrow style (uppercase, tracked) and carries the raw key as its title.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../RunContext', () => ({ useRunPage: () => ({}) }));
vi.mock('@/api/runs', () => ({ useUpdateMetric: () => ({ mutate: () => undefined, isPending: false }) }));

import { MetricDetailBody } from './MetricStrip';

const SNAKE = 'customer_eligibility_assessment_result_after_policy_review_step_with_exceptions';
const CAMEL = 'retrievedPolicyDocumentIdentifiersUsedTo';
const meta = {
  reasoning: 'Three of three re-scored samples agree within 0.05, so the judge was stable.',
  confidence: 0.82,
  [SNAKE]: 0.9,
  [CAMEL]: 4,
  الثقة: 0.8,
};

describe('MetricDetailBody facts', () => {
  it('renders every fact key exactly as the source key, in a data-part="key" element', () => {
    const { container } = render(<MetricDetailBody meta={meta} hidden={new Set()} />);
    const keys = Array.from(container.querySelectorAll<HTMLElement>('dl [data-part="key"]'));
    expect(keys.map((k) => k.textContent)).toEqual(['confidence', SNAKE, CAMEL, 'الثقة']);
    for (const k of keys) {
      expect(k.hasAttribute('title')).toBe(false);
      // the dir sits on the inner span so the label stays left-anchored
      expect(k.firstElementChild?.hasAttribute('dir')).toBe(true);
    }
    expect(container.querySelectorAll('dl [data-part="value"]').length).toBe(4);
  });

  it('keeps the prose label as the eyebrow part with the raw key as its title', () => {
    const { container } = render(<MetricDetailBody meta={meta} hidden={new Set()} />);
    const eyebrow = container.querySelector<HTMLElement>('[data-part="eyebrow"]')!;
    expect(eyebrow).toHaveTextContent('Reasoning');
    expect(eyebrow).toHaveAttribute('title', 'reasoning');
  });
});
