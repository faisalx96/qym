/** The compare report: stacked full-width sections in legacy order, a jump nav with scroll-spy, and section anchors. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { metricDirectionLabel, passThresholdLabel } from '@/lib/metrics';
import { alignToElement } from '@/lib/scrollToElement';
import { useShellScroller } from '@/features/run-detail/hooks/useScrollMargin';
import { ReportSection } from '@/ui';
import { useCompare } from '../CompareContext';
import { useScope } from '../hooks/useScope';
import { hasAnyRootCause } from '../lib/breakdown';
import { CategoriesTab, CategoryViewToggle } from './panel/CategoriesTab';
import { ErrorsTab } from './panel/ErrorsTab';
import { MetricsTab } from './panel/MetricsTab';
import { OverviewControls, OverviewTab } from './panel/OverviewTab';
import { RootCauseTab } from './panel/RootCauseTab';
import { StepsTab } from './panel/StepsTab';
import { ItemsSection } from './items/ItemsSection';
import { RunCards } from './RunCards';
import { PassToggle } from './SelectionBar';
import styles from './ReportSections.module.css';

export type SectionKey =
  'runs' | 'averages' | 'overview' | 'categories' | 'steps' | 'errors' | 'root-cause' | 'items';

export const sectionDomId = (key: SectionKey) => `compare-${key}`;

/** Old `?panel=` values and `#hash` anchors → the section they now open. */
const ALIASES: Record<string, SectionKey> = {
  runs: 'runs',
  metrics: 'averages',
  averages: 'averages',
  overview: 'overview',
  categories: 'categories',
  steps: 'steps',
  errors: 'errors',
  'root-cause': 'root-cause',
  items: 'items',
};

export function scrollToSection(key: SectionKey): void {
  const el = document.getElementById(sectionDomId(key));
  if (el) alignToElement(el);
}

/** The sections this comparison offers, in page order. */
export function useSectionList(): Array<{ key: SectionKey; label: string; count?: number }> {
  const { model, items } = useCompare();
  const traced = model.runs.some((r) => r.run.trace_stats?.has_spans);
  const rootCause = useMemo(() => hasAnyRootCause(model, new Set(model.itemIds)), [model]);
  return [
    { key: 'runs', label: 'Runs' },
    { key: 'averages', label: 'Averages' },
    { key: 'overview', label: 'Overview' },
    { key: 'categories', label: 'Categories' },
    ...(traced ? [{ key: 'steps' as const, label: 'Steps' }] : []),
    { key: 'errors', label: 'Errors' },
    ...(rootCause ? [{ key: 'root-cause' as const, label: 'Root cause' }] : []),
    { key: 'items', label: 'Items', count: items.length },
  ];
}

/** Which section the reader is in: the last one whose top has passed the bottom of the sticky chrome. */
function useSpy(keys: SectionKey[], navBottom: () => number): SectionKey {
  const scroller = useShellScroller();
  const [active, setActive] = useState<SectionKey>(keys[0] ?? 'runs');
  const joined = keys.join(',');
  useEffect(() => {
    if (!scroller) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = navBottom() + 24;
      let current = joined.split(',')[0] as SectionKey;
      for (const k of joined.split(',') as SectionKey[]) {
        const el = document.getElementById(sectionDomId(k));
        if (el && el.getBoundingClientRect().top <= line) current = k;
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
  }, [scroller, joined, navBottom]);
  return active;
}

export function ReportNav() {
  const navRef = useRef<HTMLElement>(null);
  const sections = useSectionList();
  const navBottom = useMemo(
    () => () =>
      navRef.current?.closest<HTMLElement>('[data-compare-sticky]')?.getBoundingClientRect().bottom ?? 0,
    [navRef],
  );
  const active = useSpy(
    sections.map((s) => s.key),
    navBottom,
  );
  return (
    <nav ref={navRef} className={styles.nav} aria-label="Comparison sections">
      {sections.map((s) => (
        <a
          key={s.key}
          href={`#${sectionDomId(s.key)}`}
          className={styles.link}
          aria-current={active === s.key ? 'location' : undefined}
          data-section={s.key}
          onClick={(e) => {
            e.preventDefault();
            scrollToSection(s.key);
          }}
        >
          {s.label}
          {typeof s.count === 'number' ? <span className={styles.count}>{s.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}

/** `?panel=errors` and `#errors` (old links) scroll to the section once the report has laid out. */
export function useSectionAnchor(): void {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const wanted = ALIASES[(params.get('panel') ?? hash.replace(/^#(compare-)?/, '')).toLowerCase()];
  useEffect(() => {
    if (!wanted) return undefined;
    scrollToSection(wanted);
    return undefined;
  }, [wanted]);
}

export function CompareReport() {
  const { metric, ctx, model } = useCompare();
  const scope = useScope();
  const sections = useSectionList();
  const has = (k: SectionKey) => sections.some((s) => s.key === k);
  const note = scope.active
    ? `over ${scope.shown.toLocaleString('en-US')} of ${scope.total.toLocaleString('en-US')} items`
    : undefined;
  useSectionAnchor();
  const passes = ctx.direction && !ctx.isBoolean && model.types[metric] !== 'numeric';
  const overviewDescription = `Pass rates, winners and how many runs got each item right for ${metric}. ${metricDirectionLabel(ctx.direction)}${passes ? `; a run passes when its score is ${passThresholdLabel(ctx.threshold, ctx.direction)}` : ''}.`;
  return (
    <>
      <ReportSection
        id={sectionDomId('runs')}
        title="Runs"
        description="Configuration, status and what differs between the compared runs."
      >
        <RunCards />
      </ReportSection>
      <ReportSection
        id={sectionDomId('averages')}
        title="Per-run averages"
        description="Average per run with the paired change from the baseline and its 95% noise band; press a count to filter the items."
        scopeNote={note}
        aside={<PassToggle />}
      >
        <MetricsTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('overview')}
        title="Comparison overview"
        description={overviewDescription}
        scopeNote={note}
        aside={<OverviewControls />}
      >
        <OverviewTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('categories')}
        title="Performance by category"
        description="Average per metadata value and run, against the baseline tick; press a card to filter the items."
        scopeNote={note}
        aside={<CategoryViewToggle />}
        lazy
        minHeight={200}
      >
        <CategoriesTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('steps')}
        title="Step latency"
        description="Mean latency per traced step and run."
        hidden={!has('steps')}
        lazy
        minHeight={200}
      >
        <StepsTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('errors')}
        title="Error distribution"
        description="Errors by kind and message for each run; press a card to filter the items."
        scopeNote={note}
        lazy
        minHeight={120}
      >
        <ErrorsTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('root-cause')}
        title="Root cause analysis"
        description="Why items failed, from the analyzer, per run."
        scopeNote={note}
        hidden={!has('root-cause')}
        lazy
        minHeight={160}
      >
        <RootCauseTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('items')}
        title="Item-by-item comparison"
        description="One score per run for each aligned item. Filters apply to every section above."
      >
        <ItemsSection />
      </ReportSection>
    </>
  );
}
