/**
 * Sticky section nav: run name and status once the hero has scrolled away, jump links to every section of the
 * report (scroll-spy marks the one in view; the first qym's underline tabs, round 10), the page-wide metric and its
 * Pass if threshold that every section follows (C039, C154: the only metric and threshold controls on the page), the
 * page-wide Filters rule builder and Clear, and back to top. Below 1600 px the stuck nav does not repeat the run name,
 * and the links that do not fit go into a More menu, with the active one always in the row (RF1, C132).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import {
  Button,
  DropdownMenu,
  Icon,
  IconButton,
  Popover,
  RunStatusBadge,
  SegmentedControl,
  Select,
  Slider,
} from '@/ui';
import { useMediaQuery } from '@/features/shell';
import { useShellScroller } from '../hooks/useScrollMargin';
import { countActiveFilters, type FilterGroup } from '../lib/filterRules';
import { fitNavLinks } from '../lib/navFit';
import { metricHasPassThreshold } from '../lib/runModel';
import { useRunPage } from '../RunContext';
import { RuleBuilder } from './items/RuleBuilder';
import { sectionDomId, useSectionEntries, type SectionEntry, type SectionKey } from './ReportSections';
import styles from './SectionNav.module.css';

export type SectionId = 'summary' | SectionKey;

/** Which section the reader is in: the last one whose top has passed the nav; Summary until the nav sticks. */
export function useScrollSpy(navRef: React.RefObject<HTMLElement | null>, ids: SectionKey[]): SectionId {
  const scroller = useShellScroller();
  const [active, setActive] = useState<SectionId>('summary');
  const lastActive = useRef<SectionId>('summary');
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
      // a same-value setState still re-renders once (React's bail-out happens after the render): skip it
      if (current !== lastActive.current) {
        lastActive.current = current;
        setActive(current);
      }
    };
    // Scrolling measures synchronously, in the capture phase: layout is still clean at the start of the frame's
    // scroll dispatch (no table or virtual-row write has happened yet), so these reads force no layout.
    const onScroll = (e: Event) => {
      if (e.target === scroller) measure(); // capture also sees the scrolls of inner scrollers
    };
    const onResize = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize);
    return () => {
      scroller.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
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

/** Chips fit while the metrics are few and the bar is wide; otherwise one select. */
const METRIC_CHIPS_MAX = 5;

/**
 * The page's one metric (round 10): the Repeat tiles and curves, Quality vs latency, Categories and the Items
 * analysis all follow it, so no section carries its own metric picker.
 */
function NavMetric() {
  const { model, api } = useRunPage();
  const wide = useMediaQuery('(min-width: 1680px)');
  const names = model.metricNames;
  const metric = api.selectedMetric;
  if (names.length < 2 || !metric) return null;
  const pick = (m: string) => api.setView({ metric: m === model.defaultMetric ? null : m, threshold: null });
  return (
    <span className={styles.metric} data-testid="nav-metric">
      <span className={styles.metricLabel}>Metric</span>
      {wide && names.length <= METRIC_CHIPS_MAX ? (
        <SegmentedControl<string>
          label="Metric"
          value={metric}
          onChange={pick}
          options={names.map((m) => ({ value: m, label: m }))}
        />
      ) : (
        <Select
          label="Metric"
          hideLabel
          items={names.map((m) => ({ key: m, label: m }))}
          value={metric}
          onChange={(k) => k && pick(String(k))}
          searchable={names.length > 8}
          width={150}
        />
      )}
    </span>
  );
}

/**
 * The page's one Pass if threshold (C039): Overview, Items, Quality vs latency and the Repeat tiles all read
 * ?threshold=, so this slider is the only place it is set. A repeat run keeps it for a metric with no pass rule,
 * as its Repeat section did.
 */
function NavThreshold() {
  const { model, api } = useRunPage();
  const metric = api.selectedMetric;
  const show =
    !!metric && (metricHasPassThreshold(model, metric) || (model.isRepeat && !model.metricIsBoolean[metric]));
  const value = metric
    ? Math.round((api.view.threshold ?? model.defaultThresholds[metric] ?? 0.8) * 100)
    : 80;
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  if (!show) return null;
  return (
    <Slider
      label="Pass if ≥"
      unit="%"
      layout="inline"
      minValue={0}
      maxValue={100}
      step={5}
      value={draft}
      onChange={(v) => setDraft(v as number)}
      onChangeEnd={(v) => api.setView({ threshold: (v as number) / 100 })}
      width="200px"
      className={styles.threshold}
      data-testid="nav-threshold"
    />
  );
}

/**
 * Which links stay in the row (RF1): a hidden copy of every link and of the More trigger gives the widths, and the
 * links row gives the room. Measured again when the row resizes, the links change, or another section is active.
 */
function useFittedLinks(entries: SectionEntry[], active: SectionId) {
  const rowRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<boolean[] | null>(null);
  const activeIndex = entries.findIndex((e) => e.id === active);
  const key = entries.map((e) => `${e.id}:${e.label}:${e.count ?? ''}`).join('|');
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return undefined;
    const fit = () => {
      const copies = Array.from(measure.children) as HTMLElement[];
      const more = copies.pop();
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const next = fitNavLinks(
        copies.map((c) => c.offsetWidth),
        { available: row.clientWidth, gap, more: more?.offsetWidth ?? 0, active: activeIndex },
      );
      setShown((prev) =>
        prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [key, activeIndex]);
  const fits = (i: number) => !shown || shown.length !== entries.length || shown[i];
  return {
    rowRef,
    measureRef,
    visible: entries.filter((_, i) => fits(i)),
    overflow: entries.filter((_, i) => !fits(i)),
  };
}

export function SectionNav({ onSection }: SectionNavProps) {
  const { payload } = useRunPage();
  const entries = useSectionEntries();
  const navRef = useRef<HTMLElement>(null);
  const ids = entries.map((e) => e.id);
  const active = useScrollSpy(navRef, ids);
  const { rowRef, measureRef, visible, overflow } = useFittedLinks(entries, active);
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
      data-link="block"
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
      <span ref={rowRef} className={styles.links}>
        {visible.map((e) => link(e.id, e.label, { count: e.count, danger: e.danger }))}
        {overflow.length ? (
          <DropdownMenu
            label="More sections"
            placement="bottom start"
            trigger={
              <AriaButton className={styles.link} data-testid="nav-more">
                More
                <Icon name="chevron-down" size={12} />
              </AriaButton>
            }
            items={overflow.map((e) => ({
              id: e.id,
              label: typeof e.count === 'number' ? `${e.label} (${e.count})` : e.label,
            }))}
            onAction={(id) => onSection(id as SectionId)}
          />
        ) : null}
      </span>
      <span ref={measureRef} className={styles.measure} aria-hidden="true">
        {entries.map((e) => (
          <span key={e.id} className={styles.link}>
            {e.label}
            {typeof e.count === 'number' ? <span className={styles.count}>{e.count}</span> : null}
          </span>
        ))}
        <span className={styles.link}>
          More
          <Icon name="chevron-down" size={12} />
        </span>
      </span>
      <span className={styles.actions}>
        <NavMetric />
        <NavThreshold />
        <NavFilters />
        <IconButton
          label="Back to top"
          icon={<Icon name="chevron-up" size={14} />}
          onPress={() => onSection('summary')}
          data-testid="nav-top"
        />
      </span>
    </nav>
  );
}
