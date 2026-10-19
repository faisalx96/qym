/**
 * Round 7, D2: a data key is a name. Every key row exposes data-part hooks (key, value, type, actions), the key element
 * shows the source key exactly (case included), carries the direction of its own script and has no title standing in for
 * its text; the sections variant (Input / Expected) follows the same rule.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StructuredValue } from '../StructuredValue';

const LONG = 'retrievedPolicyDocumentIdentifiersUsedToGroundTheFinalAnswerTextAfterRerankStep';
const SNAKE = 'customer_eligibility_assessment_result_after_policy_review_step_with_exceptions';
const AR = 'تحليل_أهلية_العميل_بعد_مراجعة_السياسة';
const value = {
  confidence: 0.82,
  [LONG]: ['policy-handbook.pdf', 'faq.md'],
  [SNAKE]: 'eligible',
  plan: { steps: { step_one: 'search' } },
  [AR]: 'مؤهل',
};

const keys = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-part="key"]'));

describe('KeyTree rows (variant="keys")', () => {
  it('renders every key exactly as written, in a data-part="key" element with no title', () => {
    const { container } = render(<StructuredValue value={value} variant="keys" toolbar={false} />);
    expect(keys(container).map((k) => k.textContent)).toEqual(Object.keys(value));
    for (const k of keys(container)) {
      expect(k.hasAttribute('title'), k.textContent ?? '').toBe(false);
      expect(getComputedStyle(k).textTransform).not.toBe('uppercase');
    }
  });

  it('gives the key the direction of its own script, the row stays left to right', () => {
    const { container } = render(<StructuredValue value={value} variant="keys" toolbar={false} />);
    const byText = (t: string) => keys(container).find((k) => k.textContent === t)!;
    expect(byText(AR)).toHaveAttribute('dir', 'rtl');
    expect(byText(AR)).toHaveAttribute('lang', 'ar');
    expect(byText(SNAKE)).toHaveAttribute('dir', 'auto');
    expect(container.querySelector('[data-keytree]')).toBeTruthy();
  });

  it('exposes value and type previews, and the actions group once a row is open', async () => {
    const user = userEvent.setup();
    const { container } = render(<StructuredValue value={value} variant="keys" toolbar={false} />);
    const part = (p: string) => container.querySelectorAll(`[data-part="${p}"]`);
    expect(part('value').length).toBe(3); // confidence, snake, arabic: scalars
    expect(part('type').length).toBe(2); // the array and the object
    expect(part('actions').length).toBe(0);
    await user.click(screen.getByRole('button', { name: /plan/ }));
    expect(part('actions').length).toBe(1);
    const actions = container.querySelector('[data-part="actions"]')!;
    expect(actions).toHaveTextContent('Expand all');
    expect(actions).toHaveTextContent('Collapse all');
    expect(actions.querySelector('button[aria-label="Copy plan"]')).toBeTruthy();
  });
});

describe('sections (Input / Expected)', () => {
  it('shows the section key as written and keeps the summary as a separate value part', () => {
    const { container } = render(<StructuredValue value={value} toolbar={false} />);
    expect(keys(container).map((k) => k.textContent)).toEqual(Object.keys(value));
    expect(container.querySelectorAll('[data-part="actions"]').length).toBeGreaterThan(0);
    for (const k of keys(container)) expect(k.hasAttribute('title')).toBe(false);
  });
});
