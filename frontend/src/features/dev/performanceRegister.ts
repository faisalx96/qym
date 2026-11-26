/** Registers the Performance composed pages at /__mock/performance/<variant> (dev only; see PerformanceMocks.tsx). */
import { lazy } from 'react';
import { registerMock } from '@/app/mocks';

/** Every Performance mock: the address part, then what it shows. The pages are in PerformanceMocks.tsx. */
export const PERFORMANCE_VARIANTS = [
  ['home-running', 'Home: a run is in progress'],
  ['home-idle', 'Home: nothing is running'],
  ['home-history', 'Home: the runs table narrowed by its filters'],
  ['home-no-runner', 'Home: no runner ever connected'],
  ['home-offline', 'Home: the runner went silent'],
  ['home-first-run', 'Home: no runs yet'],
  ['new-step-1', 'New run, step 1: Target and sign-in'],
  ['new-step-1-no-sign-in', 'New run, step 1: a target with no sign-in saved'],
  ['new-step-2', 'New run, step 2: Test'],
  ['new-step-3', 'New run, step 3: Load'],
  ['new-step-4', 'New run, step 4: Questions'],
  ['new-step-5', 'New run, step 5: Review and start'],
  ['new-add-target', 'New run: the Add a target dialog'],
  ['new-upload-fields', 'New run: the upload dialog, Fields step'],
  ['new-confirm-production', 'New run: the production confirmation'],
  ['run-queued', 'Run: queued'],
  ['run-running', 'Run: running'],
  ['run-token-needed', 'Run: waiting for a token'],
  ['run-stopping', 'Run: stopping'],
  ['run-break-found', 'Run: finished, the breaking point was found'],
  ['run-passed', 'Run: finished, a Smoke test that passed'],
  ['run-failed', 'Run: failed before it sent load'],
  ['run-interrupted', 'Run: interrupted, the runner went silent'],
  ['run-stopped', 'Run: stopped by a person'],
  ['run-questions', 'Run: the Questions tab'],
  ['run-log', 'Run: the Log tab, all lines'],
  ['run-events', 'Run: the Log tab, events'],
  ['run-charts', 'Run: the Charts tab'],
  ['run-setup', 'Run: the Setup tab'],
  ['run-stop-dialog', 'Run: the Stop dialog'],
  ['run-token-dialog', 'Run: the dialog that sends a new token'],
  ['runner-connected', 'Runner: connected'],
  ['runner-silent', 'Runner: silent'],
] as const;

export type PerformanceVariant = (typeof PERFORMANCE_VARIANTS)[number][0];

for (const [variant, title] of PERFORMANCE_VARIANTS) {
  registerMock({
    area: 'performance',
    variant,
    title: `Performance: ${title}`,
    component: lazy(() =>
      import('./PerformanceMocks').then((m) => ({ default: m.PERFORMANCE_PAGES[variant] })),
    ),
  });
}
