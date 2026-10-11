/**
 * /projects/:slug/environments/:envId/default-preset/edit (brief 06 §2 journey 6): the launch form
 * in editor mode. Managers edit the environment's default preset against its current version
 * (`?from=v<n>` drafts from an older one, `?promote=saved|run|job&id=` from a saved preset, run or
 * job) and publish a new version with release notes. Nothing changes until Publish.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useDocumentTitle, useMediaQuery, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { Outline } from '@/features/experiments/launch/components/Outline';
import { useLaunch, type SectionId } from '@/features/experiments/launch/LaunchContext';
import { LaunchProvider, type EditorSetup } from '@/features/experiments/launch/LaunchProvider';
import { EvaluationSection } from '@/features/experiments/launch/sections/EvaluationSection';
import { ModelsSection } from '@/features/experiments/launch/sections/ModelsSection';
import { RawJsonSection } from '@/features/experiments/launch/sections/RawJsonSection';
import { SettingsSection } from '@/features/experiments/launch/sections/SettingsSection';
import styles from '@/features/experiments/launch/LaunchPage.module.css';
import { environmentPath } from '@/features/experiments/paths';
import { ConfirmDialog, EmptyState, ErrorState, LinkButton, PageHeader, Skeleton, useToast } from '@/ui';
import { EditorEntry } from './editor/EditorEntry';
import { PublishPane, type PublishPaneProps } from './editor/PublishPane';
import { runPublish } from './editor/publish';
import { publishFailure } from '@/features/experiments/launch/model';

const conflictOutcome = (message: string) => ({
  kind: 'conflict' as const,
  message: (publishFailure(409, message, []) as { message: string }).message,
});

const SECTIONS: SectionId[] = ['models', 'settings', 'evaluation', 'raw'];

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
}: {
  onDone: (slug: string, envId: string) => void;
  onReload: () => void;
}) {
  const { editor, flags, projectId, slug, confirm } = useLaunch();
  const toast = useToast();
  const qc = useQueryClient();
  const wide = useMediaQuery('(min-width: 1200px)');
  const envId = editor?.environmentId ?? '';
  const create = useCreatePreset(projectId, envId);
  const publish = usePublishPresetVersion(projectId, envId, editor?.presetId ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<PublishPaneProps['failure']>(null);
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
      currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search,
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
    return <Skeleton kind="cards" count={3} label="Loading the default preset" />;
  if (flags.initState === 'error' || editor.state === 'error')
    return (
      <ErrorState
        error={new Error(editor?.error || 'Could not load the environment')}
        title="Could not open the editor"
        onRetry={reload}
      />
    );
  if (!editor.canPublish)
    return (
      <EmptyState
        title="Only managers publish the default preset"
        body="You can read the default preset on the environment page."
        action={
          <LinkButton to={environmentPath(slug, envId)} variant="accent">
            Back to the environment
          </LinkButton>
        }
      />
    );

  const pane = (
    <PublishPane
      notes={notes}
      onNotes={setNotes}
      saving={saving}
      failure={failure}
      onPublish={() => void onPublish()}
      onCancel={cancel}
      onReload={reload}
    />
  );
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Outline sections={SECTIONS} />
        <EditorEntry />
        {flags.envsLoading ? (
          <Skeleton kind="cards" count={3} label="Loading the environment’s settings" />
        ) : (
          <>
            <ModelsSection />
            <SettingsSection />
            <EvaluationSection />
            <RawJsonSection />
          </>
        )}
        {wide ? null : pane}
      </div>
      {wide ? <div className={styles.aside}>{pane}</div> : null}
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
    </div>
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
  const setup = useMemo(() => editorSetupFrom(params, environmentId), [params, environmentId]);
  const back = environmentPath(slug, environmentId);
  const header = (
    <PageHeader
      title={envName ? `Default preset · ${envName}` : 'Default preset'}
      description="Edit the environment’s default preset against its current version and publish it as a new version."
      actions={
        <LinkButton to={back} variant="ghost">
          Back to the environment
        </LinkButton>
      }
    />
  );
  let body;
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
        title="Could not load the environment"
        onRetry={() => void envs.refetch()}
      />
    );
  else
    body = (
      <LaunchProvider
        key={`${location.search}|${reloadKey}`}
        mode="editor"
        editor={setup}
        slug={slug}
        projectId={project.id}
        canManage={canManage}
        readOnly={readOnly}
        initialParams={new URLSearchParams()}
      >
        <EditorBody
          onDone={(s, id) => navigate(environmentPath(s, id))}
          onReload={() => setReloadKey((n) => n + 1)}
        />
      </LaunchProvider>
    );
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {header}
      {body}
    </div>
  );
}
