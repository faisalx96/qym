/**
 * The runs table scrolls inside its own container (not the app's content scroller), so the shell's
 * restoration cannot see it. Remember its offset per history entry and put it back on Back/Forward
 * once the rows have rendered.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const offsets = new Map<string, number>();
const TABLE = '[data-testid="runs-table"]';

export function useTableScrollRestoration(host: RefObject<HTMLElement | null>, ready: boolean): void {
  const location = useLocation();
  const type = useNavigationType();
  const key = useRef(location.key);
  const restored = useRef(false);
  const mountedAsPop = useRef(type === 'POP');
  useEffect(() => {
    key.current = location.key;
  }, [location.key]);

  // scroll does not bubble: listen in the capture phase on the host.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLElement && t.matches(TABLE)) offsets.set(key.current, t.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => el.removeEventListener('scroll', onScroll, { capture: true });
  }, [host]);

  useLayoutEffect(() => {
    if (!ready || restored.current || !mountedAsPop.current) return;
    const saved = offsets.get(location.key);
    restored.current = true;
    if (!saved) return;
    let tries = 0;
    let raf = 0;
    const apply = () => {
      const t = host.current?.querySelector<HTMLElement>(TABLE);
      if (t) t.scrollTop = saved;
      if (!t || Math.abs(t.scrollTop - saved) > 2) {
        if (++tries < 30) raf = requestAnimationFrame(apply);
      }
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [ready, host, location.key]);
}
