import { useState } from 'react';
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
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  SectionHeader,
  Skeleton,
  Text,
  useToast,
} from '@/ui';
import { estimateTokens, useDraftRules } from '../useDraftRules';
import { useRuleGenerator } from '../useRuleGenerator';
import { RuleEditor } from './RuleEditor';
import { CompareDialog, MergeDialog, PublishDialog } from './VersionDialogs';
import { ExamplePicker, allExampleFields, type ExampleSelection } from './ExamplePicker';
import s from './rules.module.css';

function relative(iso: string | null | undefined): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function RulesPanel({ scope, canManage }: { scope: AnalysisScope; canManage: boolean }) {
  const versions = useRuleVersions(scope);
  const config = useAnalysisConfig(scope);
  const pending = useDelayedPending(versions.isPending || config.isPending);
  if (versions.isError && !versions.data)
    return <ErrorState error={versions.error} title="Couldn’t load rule versions" onRetry={() => versions.refetch()} compact />;
  if (config.isError && !config.data)
    return <ErrorState error={config.error} title="Couldn’t load the analyzer configuration" onRetry={() => config.refetch()} compact />;
  if (!versions.data || !config.data) return pending ? <Skeleton kind="lines" rows={6} label="Loading rules" /> : null;
  return <RulesView scope={scope} data={versions.data} config={config.data} canManage={canManage && config.data.can_manage_analysis_rules} />;
}

function stateBadge(v: RuleVersion, productionId: string | null) {
  if (v.id === productionId || v.is_active) return <Badge tone="success" dot>Live</Badge>;
  if (v.status === 'draft') return <Badge tone="warning">Draft</Badge>;
  return <Badge tone="neutral">Published</Badge>;
}

function RulesView({
  scope,
  data,
  config,
  canManage,
}: {
  scope: AnalysisScope;
  data: RuleVersionsResponse;
  config: AnalysisConfig;
  canManage: boolean;
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
  const productionId = data.production_version_id;
  const fallback = versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.id === productionId) ?? versions[0] ?? null;
  const open = versions.find((v) => v.id === openId) ?? fallback;

  const generator = useRuleGenerator(scope, (job) => {
    setEpoch((n) => n + 1);
    if (job.status === 'completed' && job.result) {
      setOpenId(job.result.rule_version.id);
      const added = job.result.changes?.added ?? job.result.generated_rule_count ?? 0;
      toast.show(added ? `Added ${added} new ${added === 1 ? 'rule' : 'rules'}` : 'Rule generation finished with no new rules', { tone: 'success' });
    } else if (job.status === 'cancelled') toast.show('Rule generation cancelled', { tone: 'info' });
    else toast.show(job.error || 'Rule generation failed', { tone: 'error' });
  });

  if (!open) {
    return (
      <div className={s.rules}>
        <EmptyState compact title="No rule versions yet" body="A draft appears here once the project has rules." />
      </div>
    );
  }

  const menuVersion = versions.find((v) => v.id === menuTarget) ?? open;
  const enabledDocs = config.enabled_document_count;
  const approved = config.approved_example_count;
  const selectedExamples = examples.ids.length;
  const docsUsed = includeDocs ? enabledDocs : 0;
  const usable = docsUsed > 0 || selectedExamples > 0;
  let sourceMessage = '';
  if (!usable) {
    if (enabledDocs === 0 && approved === 0)
      sourceMessage = 'Rules cannot be generated yet. This project has neither an enabled project document nor an approved example. Add and enable a project document, or approve an example, then try again.';
    else if (includeDocs && enabledDocs === 0)
      sourceMessage = 'Rules cannot be generated yet. No enabled project documents are available. Add an approved example, or add and enable a project document, then try again.';
    else if (approved > 0 && selectedExamples === 0) sourceMessage = 'Add at least one approved example before generating rules, or turn on Project documents.';
    else sourceMessage = 'Rules cannot be generated yet. No approved examples are available, and Project documents are turned off.';
  }

  async function onCreateDraft(from: RuleVersion) {
    try {
      const res = await createDraft.mutateAsync(from.id);
      setOpenId(res.version.id);
      toast.show(`Draft v${res.version.version} created from v${from.version}`, { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || 'Could not create a draft' : 'Could not create a draft', { tone: 'error' });
    }
  }

  function onMenu(id: string) {
    const v = menuVersion;
    if (id === 'draft') void onCreateDraft(v);
    else if (id === 'download') {
      const blob = new Blob([JSON.stringify({ version: v.version, name: v.name, status: v.status, rules: v.rules }, null, 2)], { type: 'application/json' });
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

  return (
    <div className={s.layout}>
      <aside className={s.versions} aria-label="Rule versions">
        <div className={s.versionsHead}>
          <Text variant="md" weight={600}>
            Versions
          </Text>
          {canManage ? (
            <Button size="sm" loading={createDraft.isPending} onPress={() => void onCreateDraft(open)}>
              Create draft
            </Button>
          ) : null}
        </div>
        <ul className={s.versionList}>
          {versions.map((v) => (
            <li key={v.id} className={s.versionItem}>
              <button type="button" className={s.versionBtn} aria-current={v.id === open.id ? 'true' : undefined} onClick={() => setOpenId(v.id)}>
                <span className={s.versionTop}>
                  <Text variant="base" weight={600} mono>
                    {`v${v.version}`}
                  </Text>
                  {stateBadge(v, productionId)}
                </span>
                <Text variant="sm" tone="muted">
                  {`${v.rule_count} ${v.rule_count === 1 ? 'rule' : 'rules'} · ${v.created_by?.display_name ?? 'unknown'} · ${relative(v.updated_at ?? v.created_at)}`}
                </Text>
              </button>
              <DropdownMenu
                label={`Actions for v${v.version}`}
                trigger={<IconButton label={`Actions for v${v.version}`} icon="more" onPress={() => setMenuTarget(v.id)} />}
                onAction={onMenu}
                items={[
                  ...(canManage ? [{ id: 'draft', label: 'Create draft from this version' }] : []),
                  { id: 'download', label: 'Download JSON' },
                  { id: 'compare', label: 'Compare with…' },
                  ...(canManage ? [{ id: 'merge', label: 'Merge with…' }] : []),
                  ...(data.can_delete && v.id !== productionId && !v.is_active
                    ? [{ id: 'delete', label: 'Delete version', tone: 'danger' as const, separatorBefore: true }]
                    : []),
                ]}
              />
            </li>
          ))}
        </ul>
      </aside>

      <VersionWorkspace
        key={`${open.id}:${epoch}`}
        scope={scope}
        version={open}
        isProduction={open.id === productionId || open.is_active}
        canManage={canManage}
        canPromote={data.can_activate && canManage}
        onPublish={() => setPublishing(true)}
        onPromote={async () => {
          try {
            await promote.mutateAsync(open.id);
            toast.show(`v${open.version} is now live`, { tone: 'success' });
          } catch (e) {
            toast.show(e instanceof ApiError ? e.detail || 'Could not promote this version' : 'Could not promote this version', { tone: 'error' });
          }
        }}
        promoting={promote.isPending}
        onCreateDraft={() => void onCreateDraft(open)}
        sources={
          <div className={s.sources}>
            <Text variant="md" weight={600}>
              Rule sources
            </Text>
            <div className={s.sourceRow}>
              <Checkbox isSelected={includeDocs} onChange={setIncludeDocs} isDisabled={!canManage}>
                {`Add documents (${enabledDocs} enabled)`}
              </Checkbox>
              <Button size="sm" isDisabled={!canManage || approved === 0} onPress={() => setPickerOpen(true)}>
                {`Add examples (${selectedExamples} of ${approved})`}
              </Button>
              <span className={s.spacer} />
              <Button size="sm" variant="accent" loading={generator.busy} isDisabled={!canManage || !usable} onPress={() =>
                void generator.start({
                  include_documents: includeDocs,
                  include_examples: selectedExamples > 0,
                  approved_example_ids: examples.ids,
                  include_fields: examples.fields,
                  mode: 'generate',
                  rule_version_id: open.id,
                  connection_id: config.default_connection_id,
                })
              }>
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
                Add an LLM connection in project settings to generate rules.
              </Text>
            )}
          </div>
        }
        generation={
          generator.job ? (
            <div className={s.genCard} role="status" aria-label="Rule generation progress">
              <div className={s.genHead}>
                <Badge tone={generator.job.status === 'completed' ? 'success' : generator.job.status === 'failed' ? 'danger' : 'info'} dot>
                  {generator.job.status === 'running' || generator.job.status === 'queued' || generator.job.status === 'cancelling' ? String(generator.job.progress.phase) : generator.job.status}
                </Badge>
                <Text variant="base" tone="secondary">
                  Rule generation progress
                </Text>
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
              <div className={s.bar} role="progressbar" aria-label="Rule generation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={PHASE_PCT[String(generator.job.progress.phase)] ?? 10}>
                <div className={s.barFill} style={{ width: `${PHASE_PCT[String(generator.job.progress.phase)] ?? 10}%` }} />
              </div>
              {generator.job.error ? (
                <Text variant="sm" tone="danger" as="p">
                  {generator.job.error}
                </Text>
              ) : null}
            </div>
          ) : null
        }
      />

      <PublishDialog scope={scope} version={open} open={publishing} onOpenChange={setPublishing} />
      <CompareDialog key={`cmp-${open.id}`} scope={scope} versions={versions} target={open} open={comparing} onOpenChange={setComparing} />
      <MergeDialog key={`mrg-${open.id}`} scope={scope} versions={versions} target={open} open={merging} onOpenChange={setMerging} onMerged={(v) => v && setOpenId(v.id)} />
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
        description={deleting ? `v${deleting.version} is removed from the history. A version that analyses still reference cannot be deleted.` : undefined}
        tone="danger"
        confirmLabel="Delete version"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            if (openId === deleting.id) setOpenId(null);
            toast.show(`v${deleting.version} deleted`, { tone: 'success' });
          } catch (e) {
            toast.show(e instanceof ApiError ? e.detail || 'Could not delete this version' : 'Could not delete this version', { tone: 'error' });
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

const PHASE_PCT: Record<string, number> = { queued: 5, preparing: 25, generating: 60, persisting: 90, completed: 100 };

function VersionWorkspace({
  scope,
  version,
  isProduction,
  canManage,
  canPromote,
  onPublish,
  onPromote,
  promoting,
  onCreateDraft,
  sources,
  generation,
}: {
  scope: AnalysisScope;
  version: RuleVersion;
  isProduction: boolean;
  canManage: boolean;
  canPromote: boolean;
  onPublish: () => void;
  onPromote: () => void;
  promoting: boolean;
  onCreateDraft: () => void;
  sources: React.ReactNode;
  generation: React.ReactNode;
}) {
  const editable = version.status === 'draft' && canManage;
  const draft = useDraftRules(scope, version, editable);
  const settled = draft.state === 'idle' || draft.state === 'saved';
  const tokens = estimateTokens(draft.rules);
  return (
    <div className={s.main}>
      <SectionHeader
        title={`Rules in v${version.version}`}
        description={`${draft.rules.length} ${draft.rules.length === 1 ? 'rule' : 'rules'} · ~${tokens.toLocaleString()} prompt tokens`}
        aside={
          <div className={s.sourceRow}>
            <Badge tone={editable ? 'warning' : 'neutral'}>{editable ? 'Editable draft' : version.status === 'draft' ? 'Draft (read-only)' : 'Read-only'}</Badge>
            {isProduction ? <Badge tone="success" dot>Live</Badge> : null}
            {editable ? (
              <Button variant="accent" size="sm" isDisabled={!settled || draft.rules.length === 0} onPress={onPublish}>
                Publish
              </Button>
            ) : version.status === 'published' && !isProduction && canPromote ? (
              <Button variant="accent" size="sm" loading={promoting} onPress={onPromote}>
                Promote to production
              </Button>
            ) : null}
            {!editable && canManage ? (
              <Button size="sm" icon={<Icon name="edit" size={12} />} onPress={onCreateDraft}>
                Create draft to edit
              </Button>
            ) : null}
          </div>
        }
      />
      {generation}
      <RuleEditor draft={draft} editable={editable} />
      {sources}
    </div>
  );
}
