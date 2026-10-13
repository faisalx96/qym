/**
 * Sticky section nav: run name and status once the hero has scrolled away, jump links to every section of the
 * report (scroll-spy marks the one in view), and the page-wide Filters rule builder and Clear.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Icon, Popover, RunStatusBadge } from '@/ui';
import { useShellScroller } from '../hooks/useScrollMargin';
import { countActiveFilters, type FilterGroup } from '../lib/filterRules';
import { useRunPage } from '../RunContext';
import { RuleBuilder } from './items/RuleBuilder';
import { sectionDomId, useSectionEntries, type SectionKey } from './ReportSections';
import styles from './SectionNav.module.css';

export type SectionId = 'summary' | SectionKey;

/** Which section the reader is in: the last one whose top has passed the nav; Summary until the nav sticks. */
export function useScrollSpy(navRef: React.RefObject<HTMLElement | null>, ids: SectionKey[]): SectionId {
  const scroller = useShellScroller();
  const [active, setActive] = useState<SectionId>('summary');
  const key = ids.join(',');
  useEffect(() => {
    if (!scroller) return undefined;
    let frame = 0;
    const order = key ? (key.split(',') as SectionKey[]) : [];
    const measure = () => {
      frame = 0;
      const nav = navRef.current;
      if (!nav) return;
      const navBox = nav.getBoundingClientRect();
      // Stuck = the nav has reached the top of the scroller; before that the hero is still in view.
      const stuck = navBox.top <= scroller.getBoundingClientRect().top + 1 && scroller.scrollTop > 0;
      let current: SectionId = 'summary';
      if (stuck)
        for (const id of order) {
          if (id === 'reviews') continue;
          const el = document.getElementById(sectionDomId(id));
          if (el && el.getBoundingClientRect().top <= navBox.bottom + 24) current = id;
        }
      setActive(current);
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
  }, [scroller, navRef, key]);
  return active;
}

export interface SectionNavProps {
  onSection: (id: SectionId) => void;
}

function NavFilters() {
  const { api } = useRunPage();
  const { view, defs } = api;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup | null>(null);
  const count = countActiveFilters(view, defs);
  return (
    <>
      <Popover
        label="Filter rules"
        placement="bottom end"
        isOpen={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setDraft(null);
        }}
        trigger={
          <Button
            size="sm"
            variant="neutral"
            icon={<Icon name="list" size={12} />}
            data-testid="nav-open-filters"
          >
            Filters{count ? ` (${count})` : ''}
          </Button>
        }
      >
        <RuleBuilder
          rules={draft ?? view.filters.rules}
          defs={defs}
          onChange={(rules: FilterGroup) => {
            setDraft(rules);
            api.setFilters({ rules });
          }}
        />
      </Popover>
      {count > 0 ? (
        <Button size="sm" variant="ghost" onPress={() => api.clearFilters()} data-testid="nav-clear-filters">
          Clear ({count})
        </Button>
      ) : null}
    </>
  );
}

export function SectionNav({ onSection }: SectionNavProps) {
  const { payload } = useRunPage();
  const entries = useSectionEntries();
  const navRef = useRef<HTMLElement>(null);
  const ids = entries.map((e) => e.id);
  const active = useScrollSpy(navRef, ids);
  const run = payload.run;
  // The page's sticky offsets (filter bar, scroll margins) follow the nav's real height.
  useEffect(() => {
    const nav = navRef.current;
    const host = nav?.parentElement;
    if (!nav || !host || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => {
      host.style.setProperty('--run-nav-h', `${nav.offsetHeight}px`);
      host.style.setProperty('--report-nav-h', `${nav.offsetHeight}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  const status = String(run.status || '').toUpperCase();

  const link = (id: SectionId, label: string, opts: { count?: number; danger?: boolean }) => (
    <a
      key={id}
      href={`#run-section-${id}`}
      className={styles.link}
      aria-current={active === id ? 'location' : undefined}
      data-section={id}
      data-tone={opts.danger ? 'danger' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onSection(id);
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
      data-compact={active !== 'summary' ? '' : undefined}
    >
      <span className={styles.identity} aria-hidden={active === 'summary' ? true : undefined}>
        <span className={styles.name}>{run.run_name || run.run_id}</span>
        <RunStatusBadge status={status} label={String(run.status || '').toLowerCase()} />
      </span>
      <span className={styles.links}>
        {link('summary', 'Summary', {})}
        <span className={styles.sep} aria-hidden="true" />
        {entries.map((e) => link(e.id, e.label, { count: e.count, danger: e.danger }))}
      </span>
      <span className={styles.actions}>
        <NavFilters />
      </span>
    </nav>
  );
}
