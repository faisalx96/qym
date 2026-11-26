/**
 * Performance area, design stage: composed page mocks in the app shell, static, from fixtures. No API calls.
 * Layout A of the chosen design on all three pages (Home: runs table; New run: step by step; Run: tabs), plus
 * the Runner page. Every mock opens alone at /__mock/performance/<variant>; the gallery section lists them all
 * and shows the default state of each page. The page lanes build the real pages from these and from SPEC.md.
 */
import { Link } from 'react-router-dom';
import type { PerformanceRunRead, PerformanceTarget } from '@/api/performance';
import { SectionHeader, Text } from '@/ui';
import { PerformanceHomePage } from './PerformanceHomeMocks';
import { PerformanceNewRunPage, type NewRunDialog, type NewRunStep } from './PerformanceNewRunMocks';
import { PerformanceRunPage, type RunDialog, type RunTab } from './PerformanceRunMocks';
import { PerformanceRunnerPage } from './PerformanceRunnerMocks';
import { PERFORMANCE_VARIANTS, type PerformanceVariant } from './performanceRegister';
import {
  performanceHomeFirstRun,
  performanceHomeIdle,
  performanceHomeNoRunner,
  performanceHomeOffline,
  performanceHomeRunning,
  performanceRunBreakFound,
  performanceRunFailed,
  performanceRunInterrupted,
  performanceRunPassed,
  performanceRunQueued,
  performanceRunRunning,
  performanceRunStopped,
  performanceRunStopping,
  performanceRunTokenNeeded,
  performanceRunnerEvents,
  performanceRunnerEventsSilent,
  performanceRunnerRead,
  performanceRunnerReadSilent,
  performanceTargetPreprod,
  performanceTargetProduction,
} from './performanceFixtures';
import styles from './PerformanceMocks.module.css';

/** Production after someone pasted its tokens: what the confirmation mock starts from. */
const productionReady: PerformanceTarget = {
  ...performanceTargetProduction,
  sign_in_ready: true,
  tokens: [
    {
      name: 'refresh_token',
      hint: '7be2',
      version: 1,
      expires_at: null,
      expired: false,
      updated_at: '2026-11-20T10:58:00Z',
      updated_by: 'Ali',
      updated_by_user_id: 'user-ali',
    },
  ],
};

const newRun = (
  variant: PerformanceVariant,
  step: NewRunStep,
  target = performanceTargetPreprod,
  dialog?: NewRunDialog,
) =>
  function NewRunMock() {
    return <PerformanceNewRunPage variant={variant} step={step} target={target} dialog={dialog} />;
  };
const run = (
  variant: PerformanceVariant,
  read: PerformanceRunRead,
  tab?: RunTab,
  dialog?: RunDialog,
  logMode?: 'all' | 'events',
) =>
  function RunMock() {
    return <PerformanceRunPage variant={variant} read={read} tab={tab} dialog={dialog} logMode={logMode} />;
  };

export const PERFORMANCE_PAGES: Record<PerformanceVariant, () => JSX.Element> = {
  'home-running': () => (
    <PerformanceHomePage variant="home-running" home={performanceHomeRunning} run={performanceRunRunning} />
  ),
  'home-idle': () => <PerformanceHomePage variant="home-idle" home={performanceHomeIdle} />,
  'home-history': () => <PerformanceHomePage variant="home-history" home={performanceHomeIdle} filtered />,
  'home-no-runner': () => <PerformanceHomePage variant="home-no-runner" home={performanceHomeNoRunner} />,
  'home-offline': () => <PerformanceHomePage variant="home-offline" home={performanceHomeOffline} />,
  'home-first-run': () => <PerformanceHomePage variant="home-first-run" home={performanceHomeFirstRun} />,
  'new-step-1': newRun('new-step-1', 1),
  'new-step-1-no-sign-in': newRun('new-step-1-no-sign-in', 1, performanceTargetProduction),
  'new-step-2': newRun('new-step-2', 2),
  'new-step-3': newRun('new-step-3', 3),
  'new-step-4': newRun('new-step-4', 4),
  'new-step-5': newRun('new-step-5', 5),
  'new-add-target': newRun('new-add-target', 1, performanceTargetPreprod, 'add-target'),
  'new-upload-fields': newRun('new-upload-fields', 4, performanceTargetPreprod, 'upload-fields'),
  'new-confirm-production': newRun('new-confirm-production', 5, productionReady, 'confirm-production'),
  'run-queued': run('run-queued', performanceRunQueued),
  'run-running': run('run-running', performanceRunRunning),
  'run-token-needed': run('run-token-needed', performanceRunTokenNeeded),
  'run-stopping': run('run-stopping', performanceRunStopping),
  'run-break-found': run('run-break-found', performanceRunBreakFound),
  'run-passed': run('run-passed', performanceRunPassed),
  'run-failed': run('run-failed', performanceRunFailed),
  'run-interrupted': run('run-interrupted', performanceRunInterrupted),
  'run-stopped': run('run-stopped', performanceRunStopped),
  'run-questions': run('run-questions', performanceRunRunning, 'questions'),
  'run-log': run('run-log', performanceRunRunning, 'log'),
  'run-events': run('run-events', performanceRunRunning, 'log', undefined, 'events'),
  'run-charts': run('run-charts', performanceRunBreakFound, 'charts'),
  'run-setup': run('run-setup', performanceRunRunning, 'setup'),
  'run-stop-dialog': run('run-stop-dialog', performanceRunRunning, 'progress', 'stop'),
  'run-token-dialog': run('run-token-dialog', performanceRunTokenNeeded, 'progress', 'token'),
  'runner-connected': () => (
    <PerformanceRunnerPage
      variant="runner-connected"
      read={performanceRunnerRead}
      events={performanceRunnerEvents}
    />
  ),
  'runner-silent': () => (
    <PerformanceRunnerPage
      variant="runner-silent"
      read={performanceRunnerReadSilent}
      events={performanceRunnerEventsSilent}
    />
  ),
};

const GROUPS: [string, string][] = [
  ['home', 'Home'],
  ['new', 'New run'],
  ['run-', 'Run page'],
  ['runner', 'Runner'],
];
const groupOf = (variant: string) =>
  variant.startsWith('runner')
    ? 'runner'
    : variant.startsWith('run-')
      ? 'run-'
      : variant.startsWith('new')
        ? 'new'
        : 'home';

/** The default state of each page, drawn at 1440 in the gallery; every other state is one click away. */
const SHOWN: PerformanceVariant[] = ['home-running', 'new-step-1', 'run-running', 'runner-connected'];

/** The gallery section (`/__ui#performance`). */
export function PerformanceMocks() {
  return (
    <div className={styles.galleryRoot}>
      <div className={styles.index} data-performance-block="index">
        {GROUPS.map(([prefix, name]) => (
          <div key={prefix} className={styles.tight}>
            <Text variant="md" weight={600}>
              {name}
            </Text>
            <ul className={styles.indexGroup}>
              {PERFORMANCE_VARIANTS.filter(([variant]) => groupOf(variant) === prefix).map(
                ([variant, title]) => (
                  <li key={variant}>
                    <Link to={`/__mock/performance/${variant}`}>{title}</Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
      {SHOWN.map((variant) => {
        const Page = PERFORMANCE_PAGES[variant];
        return (
          <section key={variant} className={styles.stack} data-performance-case={variant}>
            <SectionHeader
              level="lg"
              title={PERFORMANCE_VARIANTS.find(([name]) => name === variant)![1]}
              description={`/__mock/performance/${variant}`}
            />
            <div className={styles.frame}>
              <Page />
            </div>
          </section>
        );
      })}
    </div>
  );
}
