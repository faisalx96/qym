/**
 * /projects/:slug/experiments/new. Two views of one form (brief 06 + the redesign brief):
 * the home view (`LaunchHome`: environments, dataset, starting point, a name, "Launch as is" or
 * "Customize") and Customize (`LaunchWizard`, `?step=where|start|models|settings|evaluation|review`:
 * one step at a time over a progress rail, the live review beside it). The step is only a view of the
 * form: the provider is keyed on the form-defining params, never on `step`.
 *
 * URL (read once on mount): `?env=` (repeatable), `?clone=<xid>[&job=<jid>]`,
 * `?base=default|saved|best_run|scratch&preset=<id>`, and the view param `?step=`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useEvalEnvironments } from '@/api/evalCommon';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LinkButton,
  PageHeader,
  Skeleton,
  Tag,
} from '@/ui';
import { environmentsPath, experimentPath, experimentsPath } from '../paths';
import { LaunchHome } from './home/LaunchHome';
import { useLaunch } from './LaunchContext';
import { LaunchProvider } from './LaunchProvider';
import { driftLines } from './model';
import { entryKey, locationKey, useStep } from './state/useStep';
import { LaunchWizard } from './wizard/LaunchWizard';
import type { RevealStep } from './wizard/steps';
import styles from './LaunchPage.module.css';

function LaunchBody({
  projectName,
  slug,
  onCancel,
}: {
  projectName: string;
  slug: string;
  onCancel: () => void;
}) {
  const { flags, baseState, doc } = useLaunch();
  const { step, goToStep, next, prev } = useStep();

  // Unsaved-changes guard: closing the tab and leaving through the router. Moving between the home
  // view and the steps (`?step=`) is not leaving.
  useEffect(() => {
    if (!flags.hasChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (!flags.unsavedGuard()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flags]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      flags.unsavedGuard() && locationKey(currentLocation) !== locationKey(nextLocation),
  );

  const drifted = driftLines(doc.base.drift).length > 0;
  const header = step ? (
    <PageHeader
      title="Customize experiment"
      meta={[
        `${projectName} · Starting point: ${doc.environmentIds.length ? baseState.label : 'none yet'}`,
        ...(drifted ? [<Tag key="drift" tone="warning">Versions changed since this run</Tag>] : []),
      ]}
      actions={
        <Button variant="ghost" onPress={() => goToStep(null)}>
          ← Start
        </Button>
      }
    />
  ) : (
    <PageHeader
      title="New experiment"
      description="Pick where it runs and what to start from. You can change anything in Customize."
      actions={
        <LinkButton to={experimentsPath(slug)} variant="ghost">
          All experiments
        </LinkButton>
      }
    />
  );

  return (
    <>
      {header}
      {step ? (
        <LaunchWizard
          step={step}
          next={next}
          prev={prev}
          onGo={(target) => goToStep(target)}
          onCancel={onCancel}
        />
      ) : (
        <LaunchHome onCustomize={(target) => goToStep(target)} />
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title="Leave without launching?"
        description="Your changes to this experiment will be lost."
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
        onCancel={() => {
          if (blocker.state === 'blocked') blocker.reset();
        }}
      />
    </>
  );
}

export function LaunchPage() {
  const { project, slug, readOnly, canManage } = useProjectContext();
  useDocumentTitle(`${project.name} · New experiment`);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const envs = useEvalEnvironments(project.id, { active: true });
  const { step, goToStep } = useStep();
  // A problem clicked in the review (or an Edit link) brings its step on screen; on the home view only
  // the fields the home view holds stay there.
  const stepRef = useRef(step);
  const goRef = useRef(goToStep);
  useEffect(() => {
    stepRef.current = step;
    goRef.current = goToStep;
  });
  const revealStep = useCallback<RevealStep>((target, opts) => {
    if (opts?.home && stepRef.current === null) return;
    if (stepRef.current === target) return;
    goRef.current(target, { replace: stepRef.current !== null });
  }, []);
  const formKey = useMemo(() => entryKey(location.search), [location.search]);
  const header = (
    <PageHeader
      title="New experiment"
      description="Pick where it runs and what to start from. You can change anything in Customize."
      actions={
        <LinkButton to={experimentsPath(slug)} variant="ghost">
          All experiments
        </LinkButton>
      }
    />
  );
  let body;
  if (envs.isPending) body = <Skeleton kind="cards" count={3} label="Loading environments" />;
  else if (envs.isError)
    body = (
      <ErrorState
        error={envs.error}
        title="Could not load the environments"
        onRetry={() => void envs.refetch()}
      />
    );
  else if (!envs.data.length)
    body = (
      <EmptyState
        title="No active environments"
        body="An experiment runs on an Evaluation Service environment. Connect one first."
        action={
          <LinkButton to={environmentsPath(slug)} variant="accent">
            {canManage ? 'Add an environment' : 'See environments'}
          </LinkButton>
        }
      />
    );
  else
    body = (
      // A new form-defining search string (e.g. "Copy an experiment") is a new form; `?step=` is not.
      <LaunchProvider
        key={formKey}
        slug={slug}
        projectId={project.id}
        canManage={canManage}
        readOnly={readOnly}
        initialParams={new URLSearchParams(params)}
        revealStep={revealStep}
        onLaunched={(id) => navigate(experimentPath(slug, id))}
      >
        <LaunchBody
          projectName={project.name}
          slug={slug}
          onCancel={() => navigate(experimentsPath(slug))}
        />
      </LaunchProvider>
    );
  const ready = !envs.isPending && !envs.isError && envs.data.length > 0;
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {ready ? null : header}
      {body}
    </div>
  );
}
