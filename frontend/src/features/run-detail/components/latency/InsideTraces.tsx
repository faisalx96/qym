/**
 * "Inside the traces": the time budget, the kind cards and the step timings of the run's traces (legacy
 * renderInside). A run that captured no step leaves the subsection out.
 */
import { useMemo, useRef, useState } from 'react';
import type { useStepLatencyQuery } from '@/api/runs';
import { ErrorState, Skeleton, Subsection } from '@/ui';
import { normalizeLatency, stepsOfFamily, type Family } from '../../lib/latencyModel';
import { KindCards } from './KindCards';
import { STEPS_VIEW, StepTimings, type StepsView } from './StepTimings';
import { TimeBudget } from './TimeBudget';
import styles from './Traces.module.css';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function InsideTraces({ query }: { query: ReturnType<typeof useStepLatencyQuery> }) {
  const D = useMemo(() => (query.data ? normalizeLatency(query.data) : null), [query.data]);
  const [view, setView] = useState<StepsView>(STEPS_VIEW);
  const [flash, setFlash] = useState<{ ids: ReadonlySet<string>; n: number } | null>(null);
  const stepsRef = useRef<HTMLElement>(null);
  const hasData = !!D && D.steps.length > 0 && D.traces > 0;
  if (!hasData && !query.isPending && !query.isError) return null;
  // A kind card's "Open in Step timings": the By step view, its groups open, its rows flashed once.
  const openSteps = (family: Family) => {
    if (!D) return;
    const { open, ids } = stepsOfFamily(D, family);
    setView((v) => ({ ...v, group: 'step', query: '', open: new Set([...v.open, ...open]) }));
    setFlash((f) => ({ ids: new Set(ids), n: (f?.n ?? 0) + 1 }));
    // The flash plays once: rows that mount later (a search, a re-sort) do not replay it.
    window.setTimeout(() => setFlash(null), 1600);
    stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <Subsection
      id="lt-inside"
      title="Inside the traces"
      description={
        hasData
          ? `Where an average trace’s time goes, across ${fmtInt(D.traces)} trace${D.traces === 1 ? '' : 's'}.`
          : undefined
      }
      className={styles.sub}
    >
      {query.isPending ? (
        <Skeleton kind="rows" rows={3} rowHeight={160} label="Loading trace timings" />
      ) : null}
      {query.isError && !hasData ? (
        <ErrorState
          compact
          error={query.error}
          title="Trace timings did not load"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {hasData ? (
        <>
          <TimeBudget D={D} />
          <KindCards D={D} onOpenSteps={openSteps} />
          <StepTimings ref={stepsRef} D={D} view={view} setView={setView} flash={flash} />
        </>
      ) : null}
    </Subsection>
  );
}
