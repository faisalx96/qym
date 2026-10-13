import { forwardRef } from 'react';
import { Text } from '@/ui';
import type { PhaseView } from '../useAnalysisPhase';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { Card } from './Card';
import { JobCard } from './JobStatus';
import { TestResults } from './TestResults';
import s from './blocks.module.css';

/**
 * The reserved Results section under Targets: idle hint, test results (with
 * skeleton rows while testing) and the job card (progress, then summary) all
 * render into this one box, so nothing above it ever moves.
 */
export const ResultsSlot = forwardRef<HTMLDivElement, { ws: RunWorkspace; phase: PhaseView }>(
  function ResultsSlot({ ws, phase }, ref) {
    const job = ws.runner.job;
    return (
      <div ref={ref} className={s.resultsSlot} id="analysis-results">
        <Card title="Results" className={s.resultsCard}>
          <div className={s.stack}>
            {job ? <JobCard job={job} phase={phase} /> : null}
            {ws.runner.startError ? (
              <Text variant="base" tone="danger" as="p" role="alert">
                {ws.runner.startError}
              </Text>
            ) : null}
            <TestResults ws={ws} quiet={Boolean(job) || Boolean(ws.runner.startError)} />
          </div>
        </Card>
      </div>
    );
  },
);
