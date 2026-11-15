import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PANE_MIN, PaneResizer, usePaneWidth } from '../PaneResizer';

const rect = (width: number) => ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0 }) as DOMRect;

function Harness() {
  const shell = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [width, setWidth] = usePaneWidth();
  return (
    <div
      ref={(el) => {
        (shell as { current: HTMLDivElement | null }).current = el;
        if (el) el.getBoundingClientRect = () => rect(1800);
      }}
    >
      <div
        ref={(el) => {
          (pane as { current: HTMLDivElement | null }).current = el;
          if (el) el.getBoundingClientRect = () => rect(width ?? 648);
        }}
      />
      <PaneResizer shell={shell} pane={pane} width={width} onWidth={setWidth} />
      <output data-testid="width">{width ?? 'default'}</output>
    </div>
  );
}

afterEach(() => localStorage.clear());

describe('PaneResizer (cv5 Q3)', () => {
  it('is a keyboard window splitter whose width is remembered, and double click resets it', () => {
    render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Resize the prompt pane' });
    expect(handle).toHaveAttribute('aria-valuenow');
    act(() => {
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    });
    expect(screen.getByTestId('width')).toHaveTextContent('664');
    expect(localStorage.getItem('qym:analyzer-pane-width')).toBe('664');
    act(() => {
      fireEvent.keyDown(handle, { key: 'End' });
    });
    expect(screen.getByTestId('width')).toHaveTextContent(String(PANE_MIN));
    act(() => {
      fireEvent.keyDown(handle, { key: 'Home' });
    });
    // the settings column keeps 600px: 1800 - 20 gap - 600
    expect(screen.getByTestId('width')).toHaveTextContent('1180');
    act(() => {
      fireEvent.doubleClick(handle);
    });
    expect(screen.getByTestId('width')).toHaveTextContent('default');
    expect(localStorage.getItem('qym:analyzer-pane-width')).toBeNull();
  });

  it('starts from the remembered width', () => {
    localStorage.setItem('qym:analyzer-pane-width', '700');
    render(<Harness />);
    expect(screen.getByTestId('width')).toHaveTextContent('700');
  });
});
