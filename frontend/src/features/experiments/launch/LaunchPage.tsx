/**
 * /projects/:slug/experiments/new (brief 06 §2.4-2.6): the two-pane launch form. The left pane is
 * the entry block (environments, dataset, starting point, name) over collapsible sections; the
 * right pane is the live review (run count, changes by step, problems, Launch). Below 1200px the
 * review sits under the sections and a sticky bar keeps Launch in reach.
 *
 * URL (read once on mount): `?env=` (repeatable), `?clone=<xid>[&job=<jid>]`,
 * `?base=default|saved|best_run|scratch&preset=<id>`.
 */
import { useEffect, useMemo } from 'react';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useEvalEnvironments } from '@/api/evalCommon';
import { useDocumentTitle, useMediaQuery, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { ConfirmDialog, EmptyState, ErrorState, LinkButton, PageHeader, Skeleton, Text } from '@/ui';
import { environmentsPath, experimentPath, experimentsPath } from '../paths';
import { Outline } from './components/Outline';
import { EntryBlock } from './entry/EntryBlock';
import { useLaunch, type SectionId } from './LaunchContext';
import { LaunchProvider } from './LaunchProvider';
import { axesOf, buildSpec } from './model';
import { MobileLaunchBar } from './review/MobileLaunchBar';
import { ReviewPane } from './review/ReviewPane';
import { EvaluationSection } from './sections/EvaluationSection';
import { ModelsSection } from './sections/ModelsSection';
import { RawJsonSection } from './sections/RawJsonSection';
import { SettingsSection } from './sections/SettingsSection';
import { SweepsSection } from './sections/SweepsSection';
import styles from './LaunchPage.module.css';

function LaunchBody({ onCancel }: { onCancel: () => void }) {
  const { doc, ctx, flags } = useLaunch();
  const wide = useMediaQuery('(min-width: 1200px)');
  const swept = useMemo(
    () => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes.length > 0,
    [doc, ctx.evaluatorPanel],
  );
  const hasEnv = doc.environmentIds.length > 0;
  const sections: SectionId[] = [
    'models',
    'settings',
    ...(swept ? (['sweeps'] as const) : []),
    'evaluation',
    'raw',
  ];

  // Unsaved-changes guard: closing the tab and leaving through the router.
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
      flags.unsavedGuard() &&
      currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search,
  );

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {hasEnv ? <Outline sections={sections} /> : null}
        <EntryBlock />
        {!hasEnv ? (
          <Text variant="base" tone="muted" className={styles.hint}>
            Pick an environment to configure models, settings and evaluation inputs.
          </Text>
        ) : flags.envsLoading ? (
          <Skeleton kind="cards" count={3} label="Loading the environments’ settings" />
        ) : (
          <>
            <ModelsSection />
            <SettingsSection />
            {swept ? <SweepsSection /> : null}
            <EvaluationSection />
            <RawJsonSection />
          </>
        )}
        {wide ? null : <ReviewPane onCancel={onCancel} hideActions />}
        {wide ? null : <MobileLaunchBar onCancel={onCancel} />}
      </div>
      {wide ? (
        <div className={styles.aside}>
          <ReviewPane onCancel={onCancel} />
        </div>
      ) : null}
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
    </div>
  );
}

export function LaunchPage() {
  const { project, slug, readOnly, canManage } = useProjectContext();
  useDocumentTitle(`${project.name} · New experiment`);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const envs = useEvalEnvironments(project.id, { active: true });
  const header = (
    <PageHeader
      title="New experiment"
      description="Pick where it runs, what it runs on and where it starts; the review stays in view."
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
      // A new search string (e.g. "Copy an experiment") is a new form.
      <LaunchProvider
        key={location.search}
        slug={slug}
        projectId={project.id}
        canManage={canManage}
        readOnly={readOnly}
        initialParams={new URLSearchParams(params)}
        onLaunched={(id) => navigate(experimentPath(slug, id))}
      >
        <LaunchBody onCancel={() => navigate(experimentsPath(slug))} />
      </LaunchProvider>
    );
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {header}
      {body}
    </div>
  );
}
