import { projectPath } from '@/app/routes';
import { useEffect, useState } from 'react';
import {
  useAnalysisConfig,
  useCreateDraft,
  useDeleteVersion,
  usePromoteVersion,
  useRuleVersions,
  type AnalysisConfig,
  type AnalysisScope,
  type RuleVersion,
  type RuleVersionsResponse,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  ActionTile,
  Button,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Flag,
  Icon,
  IconButton,
  SectionHeader,
  Skeleton,
  Text,
  TextLink,
  UserName,
  useToast,
  StatusMark,
  Timeline,
  type StatusShape,
  type StatusTone,
  type TimelineItem,
} from '@/ui';
import { APP_LOCALE, formatAgo } from '@/lib/dates';
import { formatDateParts } from '@/lib/format';
import { estimateTokens, useDraftRules } from '../useDraftRules';
import { useRuleGenerator } from '../useRuleGenerator';
import { RuleEditor } from './RuleEditor';
import { CompareDialog, MergeDialog, PublishDialog } from './VersionDialogs';
import { ExamplePicker, allExampleFields, type ExampleSelection } from './ExamplePicker';
import s from './rules.module.css';

function relative(iso: string | null | undefined): string {
  return iso ? formatAgo(iso) : '';
}

export function RulesPanel({
  scope,
  canManage,
  onOpenVersion,
}: {
  scope: AnalysisScope;
  canManage: boolean;
  /** The version open in the panel (cv5 Z11: the prompt pane says when a draft is not the prompt's rules). */
  onOpenVersion?: (version: RuleVersion | null) => void;
}) {
  const versions = useRuleVersions(scope);
  const config = useAnalysisConfig(scope);
  const pending = useDelayedPending(versions.isPending || config.isPending);
  if (versions.isError && !versions.data)
    return (
      <ErrorState
        error={versions.error}
        title="Couldn’t load rule versions"
        onRetry={() => versions.refetch()}
        compact
      />
    );
  if (config.isError && !config.data)
    return (
      <ErrorState
        error={config.error}
        title="Couldn’t load the analyzer configuration"
        onRetry={() => config.refetch()}
        compact
      />
    );
  if (!versions.data || !config.data)
    return pending ? <Skeleton kind="lines" rows={6} label="Loading rules" /> : null;
  return (
    <RulesView
      scope={scope}
      data={versions.data}
      config={config.data}
      canManage={canManage && config.data.can_manage_analysis_rules}
      onOpenVersion={onOpenVersion}
    />
  );
}

/** The version that the analyzer uses now. */
function isLive(v: RuleVersion, productionId: string | null): boolean {
  return v.id === productionId || v.is_active;
}

/** The version in use is the green star Flag, a draft is a StatusMark; a published version not in use shows nothing. */
function stateBadge(v: RuleVersion, productionId: string | null) {
  if (isLive(v, productionId)) return <ProductionFlag />;
  if (v.status === 'draft') return <StatusMark tone="warning" shape="dot" label="Draft" />;
  return null;
}

/** The rule generation job's mark by the word it shows: a phase while it works, else the job status. */
function GenerationMark({ label }: { label: string }) {
  const key = label.toLowerCase();
  const [tone, shape]: [StatusTone, StatusShape] =
    key === 'completed'
      ? ['success', 'full']
      : key === 'failed'
        ? ['danger', 'cross']
        : key === 'cancelled'
          ? ['warning', 'pause']
          : key === 'queued'
            ? ['neutral', 'ring']
            : ['info', 'orbit'];
  return <StatusMark tone={tone} shape={shape} label={label} />;
}

function ProductionFlag() {
  return (
    <Flag tone="success" icon="star">
      Production
    </Flag>
  );
}

function RulesView({
  scope,
  data,
  config,
  canManage,
  onOpenVersion,
}: {
  scope: AnalysisScope;
  data: RuleVersionsResponse;
  config: AnalysisConfig;
  canManage: boolean;
  onOpenVersion?: (version: RuleVersion | null) => void;
}) {
  const toast = useToast();
  const createDraft = useCreateDraft(scope);
  const promote = usePromoteVersion(scope);
  const remove = useDeleteVersion(scope);
  const [openId, setOpenId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState<RuleVersion | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [includeDocs, setIncludeDocs] = useState(true);
  const [examples, setExamples] = useState<ExampleSelection>({ ids: [], fields: allExampleFields() });
  const [menuTarget, setMenuTarget] = useState<string | null>(null);

  const versions = data.versions.filter((v) => !v.is_deleted);
  /** Newest first (cv5 L2). */
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  const productionId = data.production_version_id;
  const canPromote = data.can_activate && canManage;
  /** The draft to continue: a released version offers it instead of a second "Create draft" (cv5 L3). */
  const latestDraft = ordered.find((v) => v.status === 'draft') ?? null;
  const fallback = latestDraft ?? versions.find((v) => v.id === productionId) ?? ordered[0] ?? null;
  const open = versions.find((v) => v.id === openId) ?? fallback;
  useEffect(() => {
    onOpenVersion?.(open);
  }, [onOpenVersion, open]);
  useEffect(() => () => onOpenVersion?.(null), [onOpenVersion]);

  const generator = useRuleGenerator(scope, (job) => {
    setEpoch((n) => n + 1);
    if (job.status === 'completed' && job.result) {
      setOpenId(job.result.rule_version.id);
      const added = job.result.changes?.added ?? job.result.generated_rule_count ?? 0;
      const docs = job.result.documents_used ?? 0;
      const ex = job.result.examples_used ?? 0;
      const used = ` Used ${docs} ${docs === 1 ? 'document' : 'documents'} and ${ex} approved ${ex === 1 ? 'example' : 'examples'}.`;
      toast.show(
        `${added ? `Added ${added} new ${added === 1 ? 'rule' : 'rules'}.` : 'Rule generation finished with no new rules.'}${used}`,
        { tone: 'success' },
      );
    } else if (job.status === 'cancelled') toast.show('Rule generation cancelled', { tone: 'info' });
    else toast.show(job.error || 'Rule generation failed', { tone: 'error' });
  });

  if (!open) {
    // C126: a project with no version yet can start one here (managers)
    return (
      <div className={s.rules}>
        <EmptyState
          compact
          title="No rules yet"
          body="Create a draft to add rules by hand, or to generate them from project documents and approved examples."
          action={
            canManage ? (
              <Button
                variant="primary"
                icon={<Icon name="plus" size={12} />}
                loading={createDraft.isPending}
                onPress={() => void onCreateDraft(null)}
              >
                Create draft
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const menuVersion = versions.find((v) => v.id === menuTarget) ?? open;
  const enabledDocs = config.enabled_document_count;
  const approved = config.approved_example_count;
  const selectedExamples = examples.ids.length;
  const docsUsed = includeDocs ? enabledDocs : 0;
  const usable = docsUsed > 0 || selectedExamples > 0;
  // C249: say what blocks generation in the project's own numbers
  let sourceMessage = '';
  if (!usable) {
    if (enabledDocs === 0 && approved === 0)
      sourceMessage =
        'Nothing to generate from yet: enable a project document in Documents, or approve a diagnosis in Reviews.';
    else if (approved > 0 && enabledDocs > 0)
      sourceMessage = `Pick some of the ${approved} approved ${approved === 1 ? 'example' : 'examples'}, or turn on documents, to generate rules.`;
    else if (approved > 0)
      sourceMessage = `Pick some of the ${approved} approved ${approved === 1 ? 'example' : 'examples'} to generate rules. No project document is enabled.`;
    else sourceMessage = 'Turn on documents to generate rules. No diagnosis is approved yet.';
  }

  async function onCreateDraft(from: RuleVersion | null) {
    try {
      const res = await createDraft.mutateAsync(from?.id);
      setOpenId(res.version.id);
      toast.show(
        from
          ? `Draft v${res.version.version} created from v${from.version}`
          : `Draft v${res.version.version} created`,
        { tone: 'success' },
      );
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || 'Couldn’t create a draft' : 'Couldn’t create a draft', {
        tone: 'error',
      });
    }
  }

  function onMenu(id: string) {
    const v = menuVersion;
    if (id === 'live') void onPromote(v);
    else if (id === 'download') {
      const blob = new Blob(
        [JSON.stringify({ version: v.version, name: v.name, status: v.status, rules: v.rules }, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rules-v${v.version}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (id === 'compare') {
      setOpenId(v.id);
      setComparing(true);
    } else if (id === 'merge') {
      setOpenId(v.id);
      setMerging(true);
    } else if (id === 'delete') setDeleting(v);
  }

  async function onPromote(v: RuleVersion) {
    try {
      await promote.mutateAsync(v.id);
      toast.show(`v${v.version} is now live`, { tone: 'success' });
    } catch (e) {
      toast.show(
        e instanceof ApiError
          ? e.detail || 'Couldn’t make this version live'
          : 'Couldn’t make this version live',
        { tone: 'error' },
      );
    }
  }

  const timeline: TimelineItem[] = ordered.map((v) => {
    const live = isLive(v, productionId);
    return {
      key: v.id,
      // cv5 Z5: an icon mark as on the dataset Change log: draft `edit`, production `star`, other released `check`
      icon: live ? 'star' : v.status === 'draft' ? 'edit' : 'check',
      tone: live ? 'success' : v.status === 'draft' ? 'warning' : 'neutral',
      title: (
        <span className={s.versionTop}>
          <Text variant="base" weight={600} mono>
            {`v${v.version}`}
          </Text>
          {v.name && v.name !== `v${v.version}` ? <span dir="auto">{v.name}</span> : null}
          {stateBadge(v, productionId)}
        </span>
      ),
      meta: (
        <span className={s.versionMeta}>
          <span>{`${v.rule_count} ${v.rule_count === 1 ? 'rule' : 'rules'}`}</span>
          <span aria-hidden="true">·</span>
          <UserName id={v.created_by?.id} name={v.created_by?.display_name ?? 'unknown'} />
          <span aria-hidden="true">·</span>
          <span>{relative(v.updated_at ?? v.created_at)}</span>
        </span>
      ),
      actions: (
        // shown on row hover, on focus and for the selected row (Timeline revealActions)
        <DropdownMenu
          label={`Actions for v${v.version}`}
          trigger={
            <IconButton
              label={`Actions for v${v.version}`}
              icon="more"
              onPress={() => setMenuTarget(v.id)}
            />
          }
          onAction={onMenu}
          items={[
            ...(canPromote && v.status === 'published' && !live
              ? [{ id: 'live', label: 'Make live', icon: <ActionTile icon="star" /> }]
              : []),
            { id: 'download', label: 'Download JSON', icon: <ActionTile icon="braces" /> },
            { id: 'compare', label: 'Compare versions', icon: <ActionTile icon="split" /> },
            ...(canManage
              ? [{ id: 'merge', label: 'Merge versions', icon: <ActionTile icon="swap" /> }]
              : []),
            ...(data.can_delete && !live
              ? [
                  {
                    id: 'delete',
                    label: 'Delete version',
                    icon: <ActionTile icon="trash" tone="danger" />,
                    tone: 'danger' as const,
                    separatorBefore: true,
                  },
                ]
              : []),
          ]}
        />
      ),
    };
  });

  return (
    <div className={s.layout}>
      <aside className={s.versions} aria-label="Rule versions">
        <Text variant="md" weight={600} as="h3" className={s.versionsTitle}>
          Versions
        </Text>
        {/* cv5 L2: the versions read as a timeline, newest first, like the dataset Change log */}
        <Timeline
          aria-label="Versions"
          activeKey={open.id}
          onSelect={setOpenId}
          revealActions
          markAlign="start"
          items={timeline}
        />
      </aside>

      <VersionWorkspace
        key={`${open.id}:${epoch}`}
        scope={scope}
        version={open}
        canManage={canManage}
        draft={latestDraft}
        onOpenDraft={setOpenId}
        onCreateDraft={() => void onCreateDraft(open)}
        creating={createDraft.isPending}
        onPublish={() => setPublishing(true)}
        sources={
          // cv5 L3: one block on a draft: what Generate rules does, its sources, then the button
          <section className={s.sources} aria-labelledby="rule-sources-title">
            <div className={s.sourcesHead}>
              <Text variant="md" weight={600} as="h3" id="rule-sources-title">
                Rule sources
              </Text>
              <Text variant="sm" tone="muted" as="p">
                Generate rules asks the LLM to write new rules into this draft from the sources that you
                choose.
              </Text>
            </div>
            <div className={s.sourceRow}>
              <Checkbox
                isSelected={includeDocs && enabledDocs > 0}
                onChange={setIncludeDocs}
                isDisabled={!canManage || enabledDocs === 0}
              >
                {`Project documents (${enabledDocs} enabled)`}
              </Checkbox>
              <Button size="sm" isDisabled={!canManage || approved === 0} onPress={() => setPickerOpen(true)}>
                {`Choose examples (${selectedExamples} of ${approved})`}
              </Button>
              <span className={s.spacer} />
              <Button
                size="sm"
                variant="accent"
                loading={generator.busy}
                isDisabled={!canManage || !usable}
                disabledReason={usable ? undefined : 'Choose a source first'}
                onPress={() =>
                  void generator.start({
                    include_documents: includeDocs,
                    include_examples: selectedExamples > 0,
                    approved_example_ids: examples.ids,
                    include_fields: examples.fields,
                    mode: 'generate',
                    rule_version_id: open.id,
                    connection_id: config.default_connection_id,
                  })
                }
              >
                Generate rules
              </Button>
            </div>
            {sourceMessage ? (
              <Text variant="sm" tone="muted" as="p" role="status">
                {sourceMessage}
              </Text>
            ) : null}
            {generator.startError ? (
              <Text variant="sm" tone="danger" as="p" role="alert">
                {generator.startError}
              </Text>
            ) : null}
            {config.llm_configured ? null : (
              <Text variant="sm" tone="muted" as="p">
                Add an LLM connection to generate rules.{' '}
                <TextLink to={`${projectPath(scope.slug, 'settings')}?tab=llm`}>
                  Open LLM connections
                </TextLink>
              </Text>
            )}
          </section>
        }
        generation={
          generator.job ? (
            <div className={s.genCard} role="status" aria-label="Rule generation progress">
              <div className={s.genHead}>
                <GenerationMark
                  label={
                    generator.job.status === 'running' ||
                    generator.job.status === 'queued' ||
                    generator.job.status === 'cancelling'
                      ? String(generator.job.progress.phase)
                      : generator.job.status
                  }
                />
                <Text variant="base" tone="secondary">
                  Rule generation progress
                </Text>
                {generator.job.progress.phase === 'generating' ||
                generator.job.progress.phase === 'preparing' ? (
                  <Text
                    variant="sm"
                    mono
                    tone="muted"
                    as="span"
                    aria-label={
                      Number(generator.job.progress.total) > 0
                        ? `${generator.job.progress.completed ?? 0} of ${generator.job.progress.total} LLM patches`
                        : 'Preparing LLM patches'
                    }
                  >
                    {Number(generator.job.progress.total) > 0
                      ? `${generator.job.progress.completed ?? 0} / ${generator.job.progress.total}`
                      : 'Preparing…'}
                  </Text>
                ) : null}
                <span className={s.spacer} />
                {generator.busy ? (
                  <Button size="sm" loading={generator.cancelling} onPress={generator.cancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button size="sm" onPress={generator.dismiss}>
                    Dismiss
                  </Button>
                )}
              </div>
              <div
                className={s.bar}
                role="progressbar"
                aria-label="Rule generation"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={PHASE_PCT[String(generator.job.progress.phase)] ?? 10}
              >
                <div
                  className={s.barFill}
                  style={{ width: `${PHASE_PCT[String(generator.job.progress.phase)] ?? 10}%` }}
                />
              </div>
              {generator.job.error ? (
                <Text variant="sm" tone="danger" as="p">
                  {generator.job.error}
                </Text>
              ) : null}
              {generator.job.status === 'completed' && generator.job.result ? (
                <Text variant="sm" tone="muted" as="p">
                  {`Used ${generator.job.result.documents_used ?? 0} ${generator.job.result.documents_used === 1 ? 'document' : 'documents'} and ${generator.job.result.examples_used ?? 0} approved ${generator.job.result.examples_used === 1 ? 'example' : 'examples'}.${
                    generator.job.result.inference_stats?.writer_calls
                      ? ` ${generator.job.result.inference_stats.writer_calls} writer ${generator.job.result.inference_stats.writer_calls === 1 ? 'call' : 'calls'}${generator.job.result.inference_stats.patching_used ? ' across bounded patches' : ''}.`
                      : ''
                  }`}
                </Text>
              ) : null}
            </div>
          ) : null
        }
      />

      <PublishDialog scope={scope} version={open} open={publishing} onOpenChange={setPublishing} />
      <CompareDialog
        key={`cmp-${open.id}`}
        scope={scope}
        versions={versions}
        target={open}
        open={comparing}
        onOpenChange={setComparing}
      />
      <MergeDialog
        key={`mrg-${open.id}`}
        scope={scope}
        versions={versions}
        target={open}
        open={merging}
        onOpenChange={setMerging}
        onMerged={(v) => v && setOpenId(v.id)}
      />
      <ExamplePicker
        scope={scope}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={examples}
        characterLimit={config.analysis_limits.rule_writer_example_characters ?? null}
        onUse={setExamples}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete version?"
        description={
          deleting
            ? `v${deleting.version} is removed from the history. A platform admin can restore it.`
            : undefined
        }
        tone="danger"
        confirmLabel="Delete version"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            if (openId === deleting.id) setOpenId(null);
            toast.show(`v${deleting.version} deleted`, { tone: 'success' });
          } catch (e) {
            toast.show(
              e instanceof ApiError
                ? e.detail || 'Couldn’t delete this version'
                : 'Couldn’t delete this version',
              { tone: 'error' },
            );
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

const PHASE_PCT: Record<string, number> = {
  queued: 5,
  preparing: 25,
  generating: 60,
  persisting: 90,
  completed: 100,
};

function VersionWorkspace({
  scope,
  version,
  canManage,
  draft: latestDraft,
  onOpenDraft,
  onCreateDraft,
  creating,
  onPublish,
  sources,
  generation,
}: {
  scope: AnalysisScope;
  version: RuleVersion;
  canManage: boolean;
  /** The newest draft of the project, if one exists. */
  draft: RuleVersion | null;
  onOpenDraft: (id: string) => void;
  onCreateDraft: () => void;
  creating: boolean;
  onPublish: () => void;
  sources: React.ReactNode;
  generation: React.ReactNode;
}) {
  const editable = version.status === 'draft' && canManage;
  const draft = useDraftRules(scope, version, editable);
  const settled = draft.state === 'idle' || draft.state === 'saved';
  /**
   * cv5 L3: one state and one action in the header. A draft says nothing more than its Draft mark in the list and
   * offers Publish; anything else is read-only and offers the way to an editable draft.
   */
  let aside: React.ReactNode;
  if (editable) {
    // cv5 Y2: "Add rule" is the primary create action of this view, so the commit is the accent button (one solid
    // green button in a view, design language "Which button")
    aside = (
      <Button
        variant="accent"
        size="sm"
        isDisabled={!settled || draft.rules.length === 0}
        disabledReason={draft.rules.length === 0 ? 'Add a rule first' : 'Wait until the draft is saved'}
        onPress={onPublish}
      >
        Publish
      </Button>
    );
  } else {
    const otherDraft = latestDraft && latestDraft.id !== version.id ? latestDraft : null;
    aside = (
      <div className={s.sourceRow}>
        <Flag tone="neutral" icon="lock">
          Read-only
        </Flag>
        {otherDraft ? (
          <Button size="sm" onPress={() => onOpenDraft(otherDraft.id)}>
            {`Open draft v${otherDraft.version}`}
          </Button>
        ) : canManage && version.status !== 'draft' ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Icon name="plus" size={12} />}
            loading={creating}
            onPress={onCreateDraft}
          >
            {`Create draft from v${version.version}`}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={s.main}>
      {/* cv5 Y3: the Created / Updated line is the header description, directly under the title as on other headers */}
      <SectionHeader
        title={`Rules in v${version.version}`}
        aside={aside}
        description={
          <span data-testid="version-meta">
            {[
              `Created ${formatDateParts(version.created_at).full || '—'}`,
              `Updated ${formatDateParts(version.updated_at).full || '—'}`,
              `~${estimateTokens(draft.rules).toLocaleString(APP_LOCALE)} prompt tokens`,
            ].join(' · ')}
          </span>
        }
      />
      {generation}
      <RuleEditor draft={draft} editable={editable} />
      {editable ? sources : null}
    </div>
  );
}
