/**
 * Round 7 (D1): `--head-shift` is a custom property, so it is inherited: written on a container it restyles every
 * descendant on every scroll event (the open item's 594 elements: 25,616 elements styled in a 2 s scroll). The hook writes it on
 * `shiftTarget` only, and the item card points that at its bar.
 */
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStickyShift } from '../useStickyShift';

const rect = (top: number, height: number): DOMRect =>
  ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 800,
    width: 800,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

afterEach(() => vi.restoreAllMocks());

function Card({ parent, onBar }: { parent: HTMLElement; onBar: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useStickyShift({
    container: ref,
    head: (c) => c.querySelector<HTMLElement>('[data-item-bar]'),
    shiftTarget: onBar ? (c) => c.querySelector<HTMLElement>('[data-item-bar]') : undefined,
    parent,
    top: 40,
  });
  return (
    <article ref={ref} data-testid="card">
      <div data-item-bar="" data-testid="bar">
        bar
      </div>
      <p data-testid="body">body</p>
    </article>
  );
}

function setup(onBar: boolean) {
  const parent = document.createElement('div');
  document.body.append(parent);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === parent) return rect(0, 600);
    if (this.tagName === 'ARTICLE') return rect(300, 2000);
    if (this.hasAttribute('data-item-bar')) return rect(300, 32);
    return rect(0, 0);
  });
  const view = render(<Card parent={parent} onBar={onBar} />, { container: parent });
  parent.scrollTop = 800;
  parent.dispatchEvent(new Event('scroll'));
  return view;
}

describe('useStickyShift shiftTarget', () => {
  it('writes the shift on the target and on nothing else', () => {
    const { getByTestId } = setup(true);
    const bar = getByTestId('bar');
    // scrollTop 800: the line is at 840, the card starts at 300: 540 px
    expect(bar.style.getPropertyValue('--head-shift')).toBe('540px');
    expect(getByTestId('card').style.getPropertyValue('--head-shift')).toBe('');
    expect(getByTestId('body').style.getPropertyValue('--head-shift')).toBe('');
    // the card still carries the state flag the styling reads
    expect(getByTestId('card')).toHaveAttribute('data-stuck');
  });

  it('defaults to the container (the table header case)', () => {
    const { getByTestId } = setup(false);
    expect(getByTestId('card').style.getPropertyValue('--head-shift')).toBe('540px');
    expect(getByTestId('bar').style.getPropertyValue('--head-shift')).toBe('');
  });
});
