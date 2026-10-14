import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer, Icon, SplitPane, type IconName } from '@/ui';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    height: 400,
    left: 0,
    right: 1000,
    top: 0,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

function setup(storageKey?: string) {
  const view = render(
    <SplitPane label="Resize panes" storageKey={storageKey} start={<p>start</p>} end={<p>end</p>} />,
  );
  return { ...view, handle: screen.getByRole('separator', { name: 'Resize panes' }) };
}

describe('SplitPane', () => {
  it('is a focusable vertical separator with value now/min/max and no axe violations', async () => {
    const { container, handle } = setup();
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuenow', '55');
    expect(handle).toHaveAttribute('aria-valuemin', '28');
    expect(handle).toHaveAttribute('aria-valuemax', '72');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('moves 2% per arrow, jumps with Home / End, resets on double click and persists', () => {
    const { handle } = setup('qym:test-split');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '57');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '53');
    expect(window.localStorage.getItem('qym:test-split')).toBe('53');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '28');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '72');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '55');
    expect(window.localStorage.getItem('qym:test-split')).toBeNull();
  });

  it('restores the stored split and survives blocked storage', () => {
    window.localStorage.setItem('qym:test-split', '40');
    const { handle, unmount } = setup('qym:test-split');
    expect(handle).toHaveAttribute('aria-valuenow', '40');
    unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const again = setup('qym:test-split');
    expect(again.handle).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(again.handle, { key: 'ArrowRight' });
    expect(again.handle).toHaveAttribute('aria-valuenow', '57');
  });

  it('drags with the pointer', () => {
    const { handle } = setup('qym:test-split');
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 550 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    expect(handle).toHaveAttribute('aria-valuenow', '40');
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400 });
    expect(window.localStorage.getItem('qym:test-split')).toBe('40');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    expect(handle).toHaveAttribute('aria-valuenow', '40');
  });
});

describe('Drawer slots', () => {
  it('renders eyebrow, meta and the heavy scrim without axe violations', async () => {
    render(
      <Drawer
        open
        onOpenChange={() => {}}
        title="Title"
        eyebrow="Trace"
        meta={<span>8 spans</span>}
        scrim="heavy"
      >
        body
      </Drawer>,
    );
    expect(screen.getByText('Trace')).toBeInTheDocument();
    expect(screen.getByText('8 spans')).toBeInTheDocument();
    expect(document.querySelector('[data-scrim="heavy"]')).not.toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Icon span-kind glyphs', () => {
  it.each(['agent', 'retriever', 'llm', 'tool', 'chain', 'guardrail', 'embedding', 'expand'] as IconName[])(
    '%s draws a path',
    (name) => {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('path')?.getAttribute('d')).toBeTruthy();
    },
  );
});
