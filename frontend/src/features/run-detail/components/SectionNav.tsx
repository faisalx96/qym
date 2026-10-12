/**
 * Sticky section nav: run name and status once the hero has scrolled away, links to Summary, Items and each
 * analysis tab (`#run-section-*` anchors), with a scroll-spy on Summary / Items and live counts.
 */
import { useEffect, useRef, useState } from 'react';
import { RunStatusBadge } from '@/ui';
import { useShellScroller } from '../hooks/useScrollMargin';
import { useRunPage } from '../RunContext';
import { usePanelEntries, type PanelTab } from './AnalysisPanel';
import styles from './SectionNav.module.css';

export type SectionId = 'summary' | 'items';

export interface SectionNavProps {
  tab: PanelTab;
  panelOpen: boolean;
  onSection: (id: SectionId | PanelTab) => void;
}

/** Which of Summary / Items the reader is in: Items once the nav has stuck and the table has reached it. */
export function useScrollSpy(navRef: React.RefObject<HTMLElement | null>): SectionId {
  const scroller = useShellScroller();
  const [active, setActive] = useState<SectionId>('summary');
  useEffect(() => {
    if (!scroller) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const items = document.getElementById('run-items');
      const nav = navRef.current;
      if (!items || !nav) return;
      const navBox = nav.getBoundingClientRect();
      // Stuck = the nav has reached the top of the scroller; before that the hero is still in view.
      const stuck = navBox.top <= scroller.getBoundingClientRect().top + 1 && scroller.scrollTop > 0;
      setActive(stuck && items.getBoundingClientRect().top <= navBox.bottom + 24 ? 'items' : 'summary');
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroller, navRef]);
  return active;
}

export function SectionNav({ tab, panelOpen, onSection }: SectionNavProps) {
  const { payload, items } = useRunPage();
  const entries = usePanelEntries();
  const navRef = useRef<HTMLElement>(null);
  const active = useScrollSpy(navRef);
  const run = payload.run;
  // The page's sticky offsets (filter bar, scroll margins) follow the nav's real height.
  useEffect(() => {
    const nav = navRef.current;
    const host = nav?.parentElement;
    if (!nav || !host || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => host.style.setProperty('--run-nav-h', `${nav.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  const status = String(run.status || '').toUpperCase();
  const itemCount = payload.snapshot.rows.length;

  const link = (id: string, label: string, opts: { current: boolean; count?: number; danger?: boolean }) => (
    <a
      key={id}
      href={`#run-section-${id}`}
      className={styles.link}
      aria-current={opts.current ? 'location' : undefined}
      data-section={id}
      data-tone={opts.danger ? 'danger' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onSection(id as SectionId | PanelTab);
      }}
    >
      {label}
      {typeof opts.count === 'number' ? <span className={styles.count}>{opts.count}</span> : null}
    </a>
  );

  return (
    <nav
      ref={navRef}
      className={styles.nav}
      aria-label="Run sections"
      data-run-nav=""
      data-compact={active === 'items' ? '' : undefined}
    >
      <span className={styles.identity} aria-hidden={active === 'summary' ? true : undefined}>
        <span className={styles.name}>{run.run_name || run.run_id}</span>
        <RunStatusBadge status={status} label={String(run.status || '').toLowerCase()} />
      </span>
      <span className={styles.links}>
        {link('summary', 'Summary', { current: active === 'summary' })}
        {link('items', 'Items', {
          current: active === 'items',
          count: items.length === itemCount ? itemCount : items.length,
        })}
        <span className={styles.sep} aria-hidden="true" />
        {entries.map((e) =>
          link(e.id, String(e.label), {
            current: panelOpen && tab === e.id,
            count: e.count,
            danger: e.tone === 'danger' && !!e.count,
          }),
        )}
      </span>
    </nav>
  );
}
