/**
 * Perf round 6 (D1, D4, D9): the scroll path reads no layout and renders nothing.
 * jsdom has no layout, so geometry is faked; what is asserted is how often it is read and written.
 */
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '..';
import { useStickyShift } from '../useStickyShift';

const rect = (top: number, height: number, width = 800): DOMRect =>
  ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: width,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Sticky({ parent }: { parent: HTMLElement }) {
  const ref = useRef<HTMLTableElement>(null);
  useStickyShift({ container: ref, head: (t) => (t as HTMLTableElement).tHead, parent, top: 40 });
  return (
    <table ref={ref} data-testid="t">
      <thead>
        <tr>
          <th>A</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
        </tr>
      </tbody>
    </table>
  );
}

describe('useStickyShift scroll path', () => {
  it('reads no rects while scrolling and writes the shift from cached geometry', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this === parent) return rect(0, 600);
      if (this.tagName === 'TABLE') return rect(300, 3000);
      if (this.tagName === 'THEAD') return rect(300, 58);
      return rect(0, 0);
    });
    const { getByTestId, unmount } = render(<Sticky parent={parent} />, { container: parent });
    const table = getByTestId('t');
    const readsAfterMount = spy.mock.calls.length;
    expect(readsAfterMount).toBeGreaterThan(0); // the geometry cache is filled once
    for (let i = 0; i < 100; i++) {
      parent.scrollTop = i * 20;
      parent.dispatchEvent(new Event('scroll'));
    }
    expect(spy.mock.calls.length).toBe(readsAfterMount); // 0 rect reads in 100 scroll events
    // scrollTop 1980: line = 1980 + 40, table top 300 in content space -> shift 1720
    expect(table.style.getPropertyValue('--head-shift')).toBe('1720px');
    expect(table).toHaveAttribute('data-stuck');
    parent.scrollTop = 0;
    parent.dispatchEvent(new Event('scroll'));
    expect(table.style.getPropertyValue('--head-shift')).toBe('0px');
    expect(table).not.toHaveAttribute('data-stuck');
    unmount();
  });

  it('writes a style only when the rounded shift changed', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this === parent ? rect(0, 600) : this.tagName === 'TABLE' ? rect(300, 3000) : rect(300, 58);
    });
    const { getByTestId } = render(<Sticky parent={parent} />, { container: parent });
    const table = getByTestId('t');
    const set = vi.spyOn(table.style, 'setProperty');
    for (let i = 0; i < 20; i++) {
      parent.scrollTop = 100; // same position: nothing to write
      parent.dispatchEvent(new Event('scroll'));
    }
    expect(set.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

interface Row {
  id: string;
  v: string;
}
const COLS: Column<Row>[] = [{ id: 'v', header: 'V', width: 200, accessor: (r) => r.v }];

describe('DataTable scrolled state', () => {
  it('flips data-scrolled-x on the scroller without rendering the table', () => {
    const renders = vi.fn();
    const Probe = ({ r }: { r: Row }) => {
      renders();
      return <span>{r.v}</span>;
    };
    const cols: Column<Row>[] = [{ ...COLS[0]!, cell: (r) => <Probe r={r} /> }];
    const rows = [{ id: 'a', v: 'alpha' }];
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const { container } = render(
      <DataTable<Row> aria-label="t" columns={cols} rows={rows} rowKey={(r) => r.id} />,
    );
    const scroller = container.querySelector<HTMLElement>('[data-dt-scroller]')!;
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 500 });
    // the sizes are cached by the next layout observation: trigger the same path a resize would
    act(() => callbacks.forEach((cb) => cb()));
    const before = renders.mock.calls.length;
    const gbcr = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    scroller.scrollLeft = 300;
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller).toHaveAttribute('data-scrolled-x');
    expect(container.querySelector('[data-scroll-start]')).not.toBeNull();
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller).not.toHaveAttribute('data-scrolled-x');
    expect(renders.mock.calls.length).toBe(before); // 0 renders from scrolling
    expect(gbcr).not.toHaveBeenCalled(); // 0 layout reads from scrolling
  });
});
