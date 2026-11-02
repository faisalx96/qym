import { flushSync } from 'react-dom';
import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  type VirtualizerOptions,
} from '@tanstack/virtual-core';

/**
 * Row windowing for a scroll element (perf round 6, D3). The stock `useVirtualizer` re-renders its host on
 * every scroll offset change. Here the rendered window carries `overscan` extra rows on each side and the host
 * re-renders only when the visible range has used up most of that slack (or the total size changed), then the window is
 * re-centred: about one commit per `overscan / 2` rows crossed instead of one or two per row. The `isScrolling`
 * flip is never read.
 */
export function useWindowedRows<TScroll extends Element, TItem extends Element>(
  options: PartialKeys<
    VirtualizerOptions<TScroll, TItem>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  >,
): Virtualizer<TScroll, TItem> {
  const rerender = useReducer((x: number) => x + 1, 0)[1];
  // what the last render drew: first and last rendered index (overscan included), total size, row count
  const drawn = useRef({ first: -1, last: -1, total: -1, count: -1 });
  const measuring = useRef(false);
  const margin = Math.max(1, Math.floor((options.overscan ?? 1) / 4));
  // The options carry callbacks that read refs only when they run (scroll, measure), never during render.
  const resolved: VirtualizerOptions<TScroll, TItem> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, sync) => {
      const d = drawn.current;
      const r = instance.range;
      const count = instance.options.count;
      const stale =
        d.total !== instance.getTotalSize() ||
        d.count !== count ||
        (r !== null &&
          ((d.first > 0 && r.startIndex < d.first + margin) ||
            (d.last < count - 1 && r.endIndex > d.last - margin) ||
            r.startIndex < d.first ||
            r.endIndex > d.last));
      if (stale) {
        // A notify raised while React commits (measureElement is a ref callback) cannot flushSync.
        if (sync && !measuring.current) flushSync(rerender);
        else rerender();
      }
      options.onChange?.(instance, sync);
    },
  };
  // eslint-disable-next-line react-hooks/refs -- the callbacks in `resolved` read refs only when they run
  const [instance] = useState(() => {
    const v = new Virtualizer<TScroll, TItem>(resolved);
    const measureElement = v.measureElement;
    v.measureElement = (node: TItem | null) => {
      measuring.current = true;
      try {
        measureElement(node);
      } finally {
        measuring.current = false;
      }
    };
    return v;
  });
  // eslint-disable-next-line react-hooks/refs -- same pattern as @tanstack/react-virtual's own hook
  instance.setOptions(resolved);
  useLayoutEffect(() => instance._didMount(), [instance]);
  useLayoutEffect(() => {
    // record what this render drew, so a window that is still inside its slack never re-renders
    const idx = instance.getVirtualIndexes();
    drawn.current = {
      first: idx[0] ?? -1,
      last: idx[idx.length - 1] ?? -1,
      total: instance.getTotalSize(),
      count: instance.options.count,
    };
    return instance._willUpdate();
  });
  return instance;
}
