import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Chart.module.css';

interface Active {
  id: string;
  content: ReactNode;
  /** Anchor in host coordinates: top centre of the mark. */
  x: number;
  top: number;
  bottom: number;
  pinned: boolean;
}

interface TipApi {
  active: Active | null;
  tipId: string;
  show: (id: string, el: Element, content: ReactNode, pinned?: boolean) => void;
  hide: (id: string) => void;
}

const TipContext = createContext<TipApi | null>(null);

/**
 * Host for a chart: positions the tooltip and is the [data-marks] scope for sibling dimming. The tooltip is
 * `role="tooltip"`, opens on pointer hover and on keyboard focus of a mark, and on touch a tap opens and pins it
 * (Escape or a tap elsewhere closes it). It replaces the native SVG `<title>`, which lags by about a second and
 * cannot carry markup.
 */
export function ChartTooltipHost({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const [active, setActive] = useState<Active | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const show = useCallback((id: string, el: Element, content: ReactNode, pinned = false) => {
    const host = hostRef.current;
    if (!host) return;
    const h = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setActive({
      id,
      content,
      x: r.left + r.width / 2 - h.left,
      top: r.top - h.top,
      bottom: r.bottom - h.top,
      pinned,
    });
  }, []);
  const hide = useCallback((id: string) => {
    setActive((a) => (a && a.id === id && !a.pinned ? null : a));
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const tip = tipRef.current;
    if (!active || !host || !tip) {
      setPos(null);
      return;
    }
    const w = tip.offsetWidth;
    const hh = tip.offsetHeight;
    const maxLeft = Math.max(0, host.clientWidth - w);
    const left = Math.min(maxLeft, Math.max(0, active.x - w / 2));
    const below = active.top - hh - 8 < 0;
    setPos({ left, top: below ? active.bottom + 8 : active.top - hh - 8, below });
  }, [active]);

  useEffect(() => {
    if (!active?.pinned) return undefined;
    const close = () => setActive(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-mark]')) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [active?.pinned]);

  const api = useMemo(() => ({ active, tipId, show, hide }), [active, tipId, show, hide]);
  return (
    <TipContext.Provider value={api}>
      <div
        ref={hostRef}
        className={[styles.host, className].filter(Boolean).join(' ')}
        data-marks=""
        {...rest}
      >
        {children}
        {active ? (
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={styles.tip}
            data-below={pos?.below ? '' : undefined}
            style={{
              insetInlineStart: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {active.content}
          </div>
        ) : null}
      </div>
    </TipContext.Provider>
  );
}

/** Pointer and focus handlers that open the nearest ChartTooltipHost's tooltip for one mark. */
export function useMarkTip(content: ReactNode | undefined) {
  const api = useContext(TipContext);
  const id = useId();
  const open = content !== undefined && content !== null && api !== null;
  const isActive = open && api.active?.id === id;
  const handlers = open
    ? {
        onPointerEnter: (e: React.PointerEvent<Element>) => {
          if (e.pointerType !== 'touch') api.show(id, e.currentTarget, content);
        },
        onPointerLeave: () => api.hide(id),
        onFocus: (e: React.FocusEvent<Element>) => api.show(id, e.currentTarget, content),
        onBlur: () => api.hide(id),
        onClick: (e: React.MouseEvent<Element>) => {
          // A touch tap pins the tooltip; mouse clicks leave it to the hover state.
          if ((e.nativeEvent as PointerEvent).pointerType === 'touch')
            api.show(id, e.currentTarget, content, true);
        },
      }
    : {};
  return {
    handlers,
    describedBy: isActive ? api.tipId : undefined,
  };
}
