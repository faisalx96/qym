/**
 * RD10, RD11: an error card is compact (one line each for the title and the detail), a cut message has a quiet
 * "Show more" that opens it in place, and the card says when it filters the items.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrorCard } from '../ErrorsTab';
import type { ErrorBucket } from '../../../lib/rowErrors';

const bucket = (label: string): ErrorBucket => ({
  kind: 'Task error',
  label,
  count: 3,
  itemIds: new Set(['a', 'b']),
});

// jsdom has no layout: a line is "cut" when its text is wider than a 280px card at 7px a character.
const CARD_PX = 280;
let restore: Array<() => void> = [];
beforeAll(() => {
  for (const key of ['scrollWidth', 'clientWidth'] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return key === 'clientWidth' ? CARD_PX : Math.min(CARD_PX * 10, (this.textContent ?? '').length * 7);
      },
    });
    restore.push(() => before && Object.defineProperty(HTMLElement.prototype, key, before));
  }
});
afterAll(() => {
  restore.forEach((r) => r());
  restore = [];
});

describe('ErrorCard (RD10, RD11)', () => {
  it('a message that fits is printed in full, with no "Show more"', () => {
    const { container } = render(
      <ErrorCard
        bucket={bucket('TimeoutError: the model did not answer in 30s')}
        total={5}
        on={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByTestId('error-card')).toHaveTextContent('TimeoutError');
    expect(screen.getByTestId('error-card')).toHaveTextContent('the model did not answer in 30s');
    expect(container.querySelector('[data-open]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('a cut message has a quiet "Show more" that opens it in place, and it never toggles the filter', () => {
    const long = `ValueError: ${'the payload could not be parsed '.repeat(3)}`;
    const onToggle = vi.fn();
    const { container } = render(
      <ErrorCard bucket={bucket(long)} total={5} on={false} onToggle={onToggle} />,
    );
    expect(container.querySelector('[data-open]')).toBeNull();
    // the whole text is in the page (cut by CSS only), never cut in the markup
    expect(screen.getByTestId('error-card')).toHaveTextContent(long.slice('ValueError: '.length).trim());
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    // a text control, not a filled Button, and it names the text it opens
    expect(more).not.toHaveAttribute('data-variant');
    expect(document.getElementById(more.getAttribute('aria-controls')!)).not.toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('[data-open]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(container.querySelector('[data-open]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('the active card is pressed and says "Filtering items"; a click toggles the filter', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ErrorCard bucket={bucket('boom')} total={5} on={false} onToggle={onToggle} />,
    );
    expect(screen.queryByTestId('error-card-active')).toBeNull();
    fireEvent.click(screen.getByTestId('error-card'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ErrorCard bucket={bucket('boom')} total={5} on onToggle={onToggle} />);
    const card = screen.getByTestId('error-card');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveAttribute('data-selected');
    expect(screen.getByTestId('error-card-active')).toHaveTextContent('Filtering items');
  });
});
