import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTER_MS, useFirstMount } from '../useFirstMount';

function Mark({ onRender }: { onRender: () => void }) {
  const first = useFirstMount();
  onRender();
  return <i data-first={first ? '' : undefined} />;
}

describe('useFirstMount', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flips every mark mounted together in one batch, not one commit per mark', () => {
    const renders = vi.fn();
    const { container } = render(
      <>
        {Array.from({ length: 60 }, (_, i) => (
          <Mark key={i} onRender={renders} />
        ))}
      </>,
    );
    expect(container.querySelectorAll('[data-first]').length).toBe(60);
    const mounted = renders.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(ENTER_MS + 150);
    });
    expect(container.querySelectorAll('[data-first]').length).toBe(0);
    expect(renders.mock.calls.length - mounted).toBe(60); // one re-render each, in a single batch
  });

  it('sets no timer for a container whose entrance is over', () => {
    const spy = vi.spyOn(window, 'setTimeout');
    function Late() {
      return <i data-first={useFirstMount(false) ? '' : undefined} />;
    }
    const { container } = render(<Late />);
    expect(container.querySelector('[data-first]')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
