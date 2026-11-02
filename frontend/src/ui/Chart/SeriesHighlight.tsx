import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

interface Api {
  active: number | null;
  set: (series: number | null) => void;
}

const Ctx = createContext<Api>({ active: null, set: () => undefined });

/**
 * Cross-highlight scope (compare): hovering or focusing anything that calls `useSeriesHighlight(n)` (a run marker,
 * a legend entry, a matrix column header, a chart series) sets data-series-active=n on this root, and styles/marks.css
 * dims every `[data-mark][data-series]` of another series to --dim-opacity.
 */
export function SeriesHighlightRoot({
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const [active, setActive] = useState<number | null>(null);
  const set = useCallback((n: number | null) => setActive(n), []);
  const api = useMemo(() => ({ active, set }), [active, set]);
  return (
    <Ctx.Provider value={api}>
      <div data-series-active={active ?? undefined} {...rest}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

/** The currently highlighted series (1..8) or null. */
export function useActiveSeries(): number | null {
  return useContext(Ctx).active;
}

/** Handlers that highlight `series` while the pointer or focus is on the element. */
export function useSeriesHighlight(series: number) {
  const { set } = useContext(Ctx);
  return {
    onPointerEnter: () => set(series),
    onPointerLeave: () => set(null),
    onFocus: () => set(series),
    onBlur: () => set(null),
  };
}
