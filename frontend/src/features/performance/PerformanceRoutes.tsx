/**
 * The Performance area's routes: /projects/:slug/performance, then /new, /runs/:runId, /runner and /targets.
 * Each route hands its page the project slug (the run page also the run's id) as props.
 */
import { useParams } from 'react-router-dom';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { NewRunPage } from './NewRunPage';
import { PerformanceHomePage } from './PerformanceHomePage';
import { RunPage } from './RunPage';
import { RunnerPage } from './RunnerPage';
import { TargetsPage } from './TargetsPage';

export function PerformanceHomeRoute() {
  const { slug } = useProjectContext();
  return <PerformanceHomePage slug={slug} />;
}

export function PerformanceNewRunRoute() {
  const { slug } = useProjectContext();
  return <NewRunPage slug={slug} />;
}

export function PerformanceRunRoute() {
  const { slug } = useProjectContext();
  const { runId = '' } = useParams();
  // One page per run: going from one run to another starts the page again.
  return <RunPage key={runId} slug={slug} runId={runId} />;
}

export function PerformanceRunnerRoute() {
  const { slug } = useProjectContext();
  return <RunnerPage slug={slug} />;
}

export function PerformanceTargetsRoute() {
  const { slug } = useProjectContext();
  return <TargetsPage slug={slug} />;
}
