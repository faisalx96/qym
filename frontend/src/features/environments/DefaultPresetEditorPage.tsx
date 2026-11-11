/**
 * /projects/:slug/environments/:envId/default-preset/edit (brief 06 §2 journey 6): the launch form
 * in editor mode. Managers edit the environment's default preset against its current version
 * (`?from=v<n>` drafts from an older one, `?promote=saved|run|job&id=` from a saved preset, run or
 * job) and publish a new version with release notes. Nothing changes until Publish.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEvalEnvironments } from '@/api/evalCommon';
import {
  useCreatePreset,
  usePublishPresetVersion,
  presetsKey,
  fetchPresets,
  type PresetConfig,
} from '@/api/evalEnvironments';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { useCrumbLabel } from '@/lib/crumb-label';
import { fullWidth } from '@/features/shell/layout';
import { useLaunch } from '@/features/experiments/launch/LaunchContext';
import { LaunchProvider, type EditorSetup } from '@/features/experiments/launch/LaunchProvider';
import styles from '@/features/experiments/launch/LaunchPage.module.css';
import barStyles from '@/features/experiments/launch/review/launchBar.module.css';
import { entryKey, locationKey, useStep } from '@/features/experiments/launch/state/useStep';
import { LaunchWizard } from '@/features/experiments/launch/wizard/LaunchWizard';
import { EDITOR_STEPS, type RevealStep } from '@/features/experiments/launch/wizard/steps';
import { environmentPath } from '@/features/experiments/paths';
import { ConfirmDialog, EmptyState, ErrorState, Icon, LinkButton, PageHeader, Skeleton, useToast } from '@/ui';
import { changeText, useEditorChangeCount } from './editor/ComparedWithCard';
import { EditorWhere } from './editor/EditorWhere';
import { PublishReview, type PublishFailure } from './editor/PublishReview';
import { runPublish } from './editor/publish';
import { publishBlocker, publishFailure } from '@/features/experiments/launch/model';
import { plural } from '@/features/experiments/lib/format';

const conflictOutcome = (message: string) => ({
  kind: 'conflict' as const,
  message: (publishFailure(409, message, []) as { message: string }).message,
});

/** `?from=v3` / `?from=3`, `?promote=saved|run|job&id=`. */
export function editorSetupFrom(params: URLSearchParams, environmentId: string): EditorSetup {
  const setup: EditorSetup = { environmentId };
  const from = Number((params.get('from') ?? '').replace(/^v/i, ''));
  if (Number.isInteger(from) && from > 0) setup.from = from;
  const kind = params.get('promote');
  const id = params.get('id');
  if ((kind === 'saved' || kind === 'run' || kind === 'job') && id) {
    setup.promote = { kind, id };
    delete setup.from;
  }
  return setup;
}

function EditorBody({
  onDone,
  onReload,
  renderHeader,
}: {
  onDone: (slug: string, envId: string) => void;
  onReload: () => void;
  /** The page header once the compared-with version is known ("Compared with: Default preset v3"). */
  renderHeader: (comparedWith: string | null) => ReactNode;
}) {
  const { doc, editor, flags, projectId, slug, confirm, review, readOnly, focusIssue } = useLaunch();
  const toast = useToast();
  const qc = useQueryClient();
  const { step, goToStep } = useStep(EDITOR_STEPS, true);
  const changeCount = useEditorChangeCount();
  const envId = editor?.environmentId ?? '';
  const create = useCreatePreset(projectId, envId);
  const publish = usePublishPresetVersion(projectId, envId, editor?.presetId ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const done = useRef(false);
  const skipGuard = useRef(false);
  const navigate = useNavigate();

  const dirty = flags.hasChanges || notes.trim() !== '';
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (done.current || skipGuard.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !done.current &&
      !skipGuard.current &&
      locationKey(currentLocation) !== locationKey(nextLocation), // moving between steps is not leaving
  );

  const cancel = useCallback(() => navigate(environmentPath(slug, envId)), [navigate, slug, envId]);

  const onPublish = useCallback(async () => {
    if (!editor || saving) return;
    const next = editor.nextVersion;
    const changed = editor.currentVersion != null;
    const ok = await confirm({
      title: `Publish default preset v${next}?`,
      description: [
        changed
          ? `Your changes are published as v${next}, compared with v${editor.currentVersion}.`
          : 'This is the first version of the default preset of this environment.',
        'Launches that start from the default preset use it from now on. Earlier versions stay in the history and never change.',
      ],
      confirmLabel: `Publish v${next}`,
      cancelLabel: 'Keep editing',
    });
    if (!ok) return;
    setSaving(true);
    setFailure(null);
    // The publish endpoint appends a version whatever the editor started from, so a tab that went
    // stale would silently overwrite a newer version: compare with the server first.
    try {
      const latest = (await fetchPresets(projectId, envId)).presets.find((p) => p.kind === 'official');
      const now = latest?.current_version?.version ?? null;
      if (now !== editor.currentVersion) {
        setSaving(false);
        void qc.invalidateQueries({ queryKey: presetsKey(projectId, envId) });
        setFailure(
          conflictOutcome(
            now == null
              ? 'The default preset was removed meanwhile'
              : `v${now} of the default preset was published meanwhile`,
          ),
        );
        return;
      }
    } catch {
      // The publish itself reports a network or permission problem.
    }
    const outcome = await runPublish(
      {
        create: (body) => create.mutateAsync(body),
        publish: (_presetId, body) => publish.mutateAsync(body),
      },
      {
        presetId: editor.presetId,
        config: editor.buildConfig() as PresetConfig,
        notes,
        fallbackVersion: next,
      },
    );
    setSaving(false);
    if (outcome.kind === 'ok') {
      done.current = true;
      void qc.invalidateQueries({ queryKey: presetsKey(projectId, envId) });
      toast.show(
        `Published default preset v${outcome.version}${outcome.warnings ? ` (${outcome.warnings} warning${outcome.warnings === 1 ? '' : 's'})` : ''}`,
        { tone: 'success' },
      );
      onDone(slug, envId);
      return;
    }
    setFailure({ kind: outcome.kind, message: outcome.message });
  }, [editor, saving, confirm, create, publish, notes, qc, projectId, envId, toast, onDone, slug]);

  const reload = useCallback(() => {
    skipGuard.current = true;
    onReload();
  }, [onReload]);

  if (!editor || flags.initState === 'loading' || editor.state === 'loading')
    return (
      <>
        {renderHeader(null)}
        <Skeleton kind="cards" count={3} label="Loading the default preset" />
      </>
    );
  if (flags.initState === 'error' || editor.state === 'error')
    return (
      <>
        {renderHeader(null)}
        <ErrorState
          error={new Error(editor?.error || 'Couldn’t load the environment')}
          title="Couldn’t open the editor"
          onRetry={reload}
        />
      </>
    );
  if (!editor.canPublish)
    return (
      <>
        {renderHeader(null)}
        <EmptyState
          title="Only managers publish the default preset"
          body="You can read the default preset on the environment page."
          action={
            <LinkButton to={environmentPath(slug, envId)} variant="accent">
              Back to the environment
            </LinkButton>
          }
        />
      </>
    );

  const current = editor.currentVersion;
  const comparedWith = current != null ? `v${current}` : 'Blank';
  const blockedBy = publishBlocker({
    loaded: Boolean(editor.state === 'ready' && doc.base.loaded && !flags.envsLoading),
    problems: review.items.length,
    requireChange: current != null,
    unchanged: Boolean(editor.unchanged),
    baseLabel: doc.base.label || comparedWith,
    notes,
  });
  const first = review.items[0];
  const status = (
    <>
      <span className={barStyles.runs} aria-live="polite">
        {changeText(changeCount, comparedWith, !editor.unchanged)}
      </span>
      {first ? (
        <button type="button" className={barStyles.problem} onClick={() => focusIssue(first)}>
          {`Fix ${plural(review.items.length, 'problem')} first`}
          <span className={barStyles.long}>{`: ${first.label}`}</span>
        </button>
      ) : blockedBy ? (
        // one status line at 390: the explanation is on the Review step; the bar keeps the change count (round 10, C-1-9)
        <span className={`${barStyles.muted} ${barStyles.long}`}>{blockedBy}</span>
      ) : (
        <span className={barStyles.ok}>Ready to publish</span>
      )}
    </>
  );
  return (
    <>
      {renderHeader(doc.base.label || comparedWith)}
      <LaunchWizard
        mode="editor"
        steps={EDITOR_STEPS}
        step={step ?? 'where'}
        onGo={(target) => goToStep(target)}
        onBack={cancel}
        onCancel={cancel}
        primary={{
          label: `Publish v${editor.nextVersion}`,
          disabled: readOnly || Boolean(blockedBy) || saving,
          loading: saving,
          onPress: () => void onPublish(),
        }}
        status={status}
        renderStep={(target) => (target === 'where' ? <EditorWhere /> : undefined)}
        review={
          <PublishReview
            notes={notes}
            onNotes={setNotes}
            saving={saving}
            failure={failure}
            blocker={blockedBy}
            onReload={reload}
          />
        }
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title="Leave without publishing?"
        description="Your changes to the default preset will be lost."
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

export function DefaultPresetEditorPage({ environmentId }: { environmentId: string }) {
  const { project, slug, readOnly, canManage } = useProjectContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [reloadKey, setReloadKey] = useState(0);
  const envs = useEvalEnvironments(project.id, { active: true });
  const envName = envs.data?.find((e) => e.id === environmentId)?.name;
  useDocumentTitle(`${project.name} · Default preset${envName ? ` · ${envName}` : ''}`);
  useCrumbLabel(envName);
  const setup = useMemo(() => editorSetupFrom(params, environmentId), [params, environmentId]);
  const back = environmentPath(slug, environmentId);
  const headerFor = (comparedWith: string | null) => (
    <PageHeader
      title={envName ? `Default preset · ${envName}` : 'Default preset'}
      meta={comparedWith ? [`${project.name} · Compared with: ${comparedWith}`] : undefined}
      description={
        comparedWith
          ? undefined
          : 'Edit the environment’s default preset against its current version and publish it as a new version.'
      }
      actions={
        <LinkButton to={back} variant="ghost" icon={<Icon name="chevron-left" size={12} />}>
          Back to the environment
        </LinkButton>
      }
    />
  );
  const header = headerFor(null);
  // A problem clicked in the review (or an Edit link) brings its step on screen.
  const { step: currentStep, goToStep } = useStep(EDITOR_STEPS, true);
  const stepRef = useRef(currentStep);
  const goRef = useRef(goToStep);
  useEffect(() => {
    stepRef.current = currentStep;
    goRef.current = goToStep;
  });
  const revealStep = useCallback<RevealStep>((target) => {
    if (stepRef.current === target) return;
    goRef.current(target, { replace: true });
  }, []);
  let body;
  let ownHeader = false;
  if (!canManage)
    body = (
      <EmptyState
        title="Only managers publish the default preset"
        body="Project managers and admins edit and publish it. You can read the current version on the environment page."
        action={
          <LinkButton to={back} variant="accent">
            Back to the environment
          </LinkButton>
        }
      />
    );
  else if (readOnly)
    body = (
      <EmptyState
        title="This project is archived"
        body="Nothing can be published while the project is read only."
        action={
          <LinkButton to={back} variant="accent">
            Back to the environment
          </LinkButton>
        }
      />
    );
  else if (envs.isPending) body = <Skeleton kind="cards" count={3} label="Loading the environment" />;
  else if (envs.isError)
    body = (
      <ErrorState
        error={envs.error}
        title="Couldn’t load the environment"
        onRetry={() => void envs.refetch()}
      />
    );
  else {
    // The editor draws its own header: it knows the version the draft is compared with.
    ownHeader = true;
    body = (
      <LaunchProvider
        key={`${entryKey(location.search)}|${reloadKey}`}
        mode="editor"
        editor={setup}
        slug={slug}
        projectId={project.id}
        canManage={canManage}
        readOnly={readOnly}
        initialParams={new URLSearchParams()}
        revealStep={revealStep}
      >
        <EditorBody
          onDone={(s, id) => navigate(environmentPath(s, id))}
          onReload={() => setReloadKey((n) => n + 1)}
          renderHeader={headerFor}
        />
      </LaunchProvider>
    );
  }
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {ownHeader ? null : header}
      {body}
    </div>
  );
}
