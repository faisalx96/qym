/** The compare report: stacked full-width sections in legacy order, a jump nav with scroll-spy, and section anchors. */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { metricDirectionLabel, passThresholdLabel } from '@/lib/metrics';
import { useShellScroller } from '@/features/run-detail/hooks/useScrollMargin';
import { scrollCue, useScrollCue } from '@/ui';
import { useCompare } from '../CompareContext';
import { hasAnyRootCause } from '../lib/breakdown';
import { CategoriesSection } from './panel/CategoriesTab';
import { ErrorsTab } from './panel/ErrorsTab';
import { MetricsTab } from './panel/MetricsTab';
import { OverviewControls, OverviewTab } from './panel/OverviewTab';
import { RootCauseTab } from './panel/RootCauseTab';
import { StepsTab } from './panel/StepsTab';
import { ItemsHeadAside, ItemsSection } from './items/ItemsSection';
import { CompareSection } from './CompareSection';
import { RunCards } from './RunCards';
import { BaselineSelect, PassToggle } from './SelectionBar';
import styles from './ReportSections.module.css';

import { scrollToSection, sectionDomId, type SectionKey } from './sectionIds';

export { scrollToSection, sectionDomId, type SectionKey };

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
  // Edge fade while more sections lie past the visible edge (a phone shows about four of them).
  const navRef = useScrollCue<HTMLElement>();
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
    <nav ref={navRef} className={`${styles.nav} ${scrollCue}`} aria-label="Comparison sections">
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
  const sections = useSectionList();
  const has = (k: SectionKey) => sections.some((s) => s.key === k);
  useSectionAnchor();
  const passes = ctx.direction && !ctx.isBoolean && model.types[metric] !== 'numeric';
  const overviewDescription = `Pass rates, winners and how many runs got each item right for ${metric}. ${metricDirectionLabel(ctx.direction)}${passes ? `; a run passes when its score is ${passThresholdLabel(ctx.threshold, ctx.direction)}` : ''}.`;
  return (
    <>
      <CompareSection
        id={sectionDomId('runs')}
        part="section-runs"
        title="Runs"
        description="Configuration and status of the compared runs. Remove a run with the cross; at least two stay."
      >
        <RunCards />
      </CompareSection>
      <CompareSection
        id={sectionDomId('averages')}
        part="section-averages"
        title="Per-run averages"
        description="Each run against the baseline: the change, its 95% noise band, and how many items improved or regressed. Press a count to filter the items."
        aside={
          <>
            <BaselineSelect />
            <PassToggle />
          </>
        }
      >
        <MetricsTab />
      </CompareSection>
      <CompareSection
        id={sectionDomId('overview')}
        part="section-overview"
        title="Comparison overview"
        description={overviewDescription}
        aside={<OverviewControls />}
      >
        <OverviewTab />
      </CompareSection>
      <CategoriesSection />
      <CompareSection
        id={sectionDomId('steps')}
        part="section-steps"
        title="Step latency"
        description="Mean latency per traced step and run."
        hidden={!has('steps')}
      >
        <StepsTab />
      </CompareSection>
      <CompareSection
        id={sectionDomId('errors')}
        part="section-errors"
        title="Error distribution"
        description="Errors by kind and message for each run. Press a card to filter the items."
      >
        <ErrorsTab />
      </CompareSection>
      <CompareSection
        id={sectionDomId('root-cause')}
        part="section-root-cause"
        title="Root cause analysis"
        description="Why items failed, from the analyzer, per run."
        hidden={!has('root-cause')}
      >
        <RootCauseTab />
      </CompareSection>
      <CompareSection
        id={sectionDomId('items')}
        part="section-items"
        title="Item-by-item comparison"
        description="Filter and inspect aligned inputs, outputs, scores and review metadata."
        aside={<ItemsHeadAside />}
      >
        <ItemsSection />
      </CompareSection>
    </>
  );
}
