import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  analysisConfigKey,
  errorDetail,
  useAnalysisConfig,
  useSaveCategoryCatalog,
  type AnalysisConfig,
  type AnalysisScope,
  type CategoryCatalog,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  TabPanel,
  Tabs,
  Tag,
  Text,
  Textarea,
  TextField,
  useToast,
} from '@/ui';
import {
  approvalSignature,
  catalogFromConfig,
  catalogPayload,
  catalogSignature,
  validateCatalog,
  type CatalogDraft,
  type CategoryDraft,
  type SubDraft,
} from '../model/catalog';
import { rootCauseIssues } from '../model/rootCause';
import s from './guidance.module.css';
import d from './diagnosis.module.css';

interface Draft {
  /** Signature of the baseline the edits started from (dirty = value differs from it). */
  start: string;
  /** Approval signature when editing began (new approvals while dirty -> banner). */
  approvals: string;
  value: CatalogDraft;
}

type SaveBadge = { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string };

const clone = (draft: CatalogDraft): CatalogDraft => ({
  ...draft,
  categories: draft.categories.map((c) => ({ ...c, subs: c.subs.map((x) => ({ ...x })) })),
});

export function DiagnosisPanel({ scope, slug, canManage }: { scope: AnalysisScope; slug: string; canManage: boolean }) {
  const config = useAnalysisConfig(scope);
  const showSkeleton = useDelayedPending(config.isPending);
  if (config.isError && !config.data)
    return <ErrorState error={config.error} title="Couldn’t load categories" onRetry={() => config.refetch()} compact />;
  if (!config.data) return showSkeleton ? <Skeleton kind="lines" rows={6} label="Loading categories" /> : null;
  return <DiagnosisEditor config={config.data} scope={scope} slug={slug} canManage={canManage} />;
}

function DiagnosisEditor({
  config,
  scope,
  slug,
  canManage,
}: {
  config: AnalysisConfig;
  scope: AnalysisScope;
  slug: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useSaveCategoryCatalog(slug, scope);
  const baseline = useMemo(() => catalogFromConfig(config), [config]);
  const baselineSig = useMemo(() => catalogSignature(baseline), [baseline]);
  const approvals = useMemo(() => approvalSignature(config), [config]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('guidance');
  const [subFilter, setSubFilter] = useState<'all' | 'approved'>('all');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newSub, setNewSub] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CategoryCatalog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const dirty = draft !== null && catalogSignature(draft.value) !== draft.start;
  const current: CatalogDraft = useMemo(() => {
    if (!draft || !dirty) return baseline;
    // Examples and counts always come from the freshest config; edits come from the draft.
    const fresh = new Map(baseline.categories.map((c) => [c.name, c]));
    return {
      ...draft.value,
      categories: draft.value.categories.map((c) => {
        const live = fresh.get(c.name);
        return live ? { ...c, examples: live.examples, exampleCount: live.exampleCount } : c;
      }),
    };
  }, [draft, dirty, baseline]);

  const problems = useMemo(() => validateCatalog(current), [current]);
  const incomplete = new Set(problems.categories);
  const hasProblems = problems.categories.length + problems.subcategories.length > 0;
  const newApprovals = dirty && draft !== null && draft.approvals !== approvals;

  const categories = current.categories;
  const active: CategoryDraft | undefined = categories.find((c) => c.name === selected) ?? categories[0];
  const visible = categories.filter((c) => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const totalExamples = categories.reduce((n, c) => n + c.exampleCount, 0);

  function edit(fn: (value: CatalogDraft) => CatalogDraft) {
    const base = dirty && draft ? draft.value : baseline;
    const next = fn(clone(base));
    setDraft({
      start: draft?.start ?? baselineSig,
      approvals: draft?.approvals ?? approvals,
      value: next,
    });
    setFailure(null);
  }
  const editCategory = (name: string, fn: (c: CategoryDraft) => CategoryDraft) =>
    edit((v) => ({ ...v, categories: v.categories.map((c) => (c.name === name ? fn(c) : c)) }));
  const editSub = (cat: string, sub: string, patch: Partial<SubDraft>) =>
    editCategory(cat, (c) => ({ ...c, subs: c.subs.map((x) => (x.name === sub ? { ...x, ...patch, touched: true } : x)) }));

  async function submit(overrideRevision?: number) {
    if (hasProblems) {
      setShowProblems(true);
      return;
    }
    setShowProblems(false);
    const payload = catalogPayload(current);
    if (overrideRevision != null) payload.base_revision = overrideRevision;
    try {
      const result = await save.mutateAsync(payload);
      await qc.invalidateQueries({ queryKey: analysisConfigKey(scope) });
      setDraft(null);
      setConflict(null);
      toast.show(result.created ? 'Categories saved' : 'No changes to save', { tone: result.created ? 'success' : 'info' });
    } catch (e) {
      const detail = errorDetail(e);
      if (e instanceof ApiError && e.status === 409 && detail?.code === 'catalog_version_conflict') {
        setConflict((detail.current_catalog as CategoryCatalog | undefined) ?? { version: 0, categories: [] });
      } else {
        setFailure(e instanceof ApiError ? e.detail || 'Could not save diagnosis categories.' : 'Could not save diagnosis categories.');
      }
    }
  }

  async function reloadLatest() {
    setDraft(null);
    setConflict(null);
    setFailure(null);
    await qc.invalidateQueries({ queryKey: analysisConfigKey(scope) });
  }

  const badge: SaveBadge = save.isPending
    ? { tone: 'info', label: 'Saving…' }
    : conflict
      ? { tone: 'danger', label: 'Conflict' }
      : failure
        ? { tone: 'danger', label: 'Save failed' }
        : showProblems && hasProblems
          ? { tone: 'warning', label: 'Taxonomy required' }
          : dirty
            ? { tone: 'warning', label: 'Unsaved changes' }
            : { tone: 'success', label: 'Saved' };

  function addCategory() {
    const name = newName.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      toast.show(`“${name}” already exists`, { tone: 'error' });
      return;
    }
    edit((v) => ({
      ...v,
      categories: [
        ...v.categories,
        { name, description: '', whenToUse: '', subs: [], exampleCount: 0, examples: [], isNew: true },
      ],
    }));
    setSelected(name);
    setSection('guidance');
    setNewName('');
    setAdding(false);
  }

  function addSub() {
    const name = newSub.trim();
    if (!name || !active) return;
    if (active.subs.some((x) => x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      toast.show(`“${name}” already exists in ${active.name}`, { tone: 'error' });
      return;
    }
    // A new subcategory stays visible even when "Approved only" is on.
    setSubFilter('all');
    editCategory(active.name, (c) => ({
      ...c,
      subs: [
        ...c.subs,
        { name, description: '', whenToUse: '', exampleOnly: false, isNew: true, touched: true, hadTaxonomy: false },
      ],
    }));
    setNewSub('');
  }

  // "Approved" = the subcategory appears in at least one approved example of this category.
  const approvedSubs = new Set(
    (active?.examples ?? []).flatMap((x) =>
      (x.root_cause_issues ?? []).map((i) => (i.subcategory ?? '').trim().toLocaleLowerCase()).concat((x.detail ?? '').trim().toLocaleLowerCase()),
    ),
  );
  const subsShown = active
    ? active.subs.filter((x) => subFilter === 'all' || x.isNew || approvedSubs.has(x.name.toLocaleLowerCase()))
    : [];

  return (
    <div className={s.diag}>
      <SectionHeader
        title="Diagnosis categories"
        description={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'} · ${totalExamples} approved ${totalExamples === 1 ? 'example' : 'examples'}`}
        aside={
          <div className={d.saveCluster}>
            <Badge tone={badge.tone} dot role="status" data-testid="catalog-save-state">
              {badge.label}
            </Badge>
            <Button
              variant="accent"
              size="sm"
              isDisabled={!canManage || !dirty || save.isPending}
              onPress={() => void submit()}
            >
              Save changes
            </Button>
          </div>
        }
      />
      {!canManage ? (
        <div className={s.banner} role="note">
          <Icon name="info" size={14} />
          <Text variant="base" tone="secondary">
            Project manager access is required to edit categories. You can read the catalog and its examples.
          </Text>
        </div>
      ) : null}
      {conflict ? (
        <div className={s.banner} role="alert" data-tone="danger">
          <Icon name="warning" size={14} />
          <div className={s.bannerText}>
            <Text variant="md" weight={600}>
              The catalog changed while you were editing
            </Text>
            <Text variant="base" tone="secondary">
              {`Someone saved revision ${conflict.version}. Your edits are still here. Reload to take theirs (your edits are discarded) or overwrite theirs with yours.`}
            </Text>
          </div>
          <Button size="sm" onPress={() => void reloadLatest()}>
            Reload latest
          </Button>
          <Button size="sm" variant="danger" onPress={() => void submit(conflict.version)}>
            Overwrite with my edits
          </Button>
        </div>
      ) : null}
      {failure ? (
        <div className={s.banner} role="alert" data-tone="danger">
          <Icon name="warning" size={14} />
          <Text variant="base" tone="secondary">
            {failure}
          </Text>
        </div>
      ) : null}
      {showProblems && hasProblems ? (
        <div className={s.banner} role="alert" data-tone="warning">
          <Icon name="info" size={14} />
          <Text variant="base" tone="secondary">
            {`Add both Description and Use when for: ${[...problems.categories, ...problems.subcategories].join(', ')}.`}
          </Text>
        </div>
      ) : null}
      {newApprovals ? (
        <div className={s.banner} role="status" data-tone="warning">
          <Icon name="info" size={14} />
          <Text variant="base" tone="secondary">
            New approvals are available. Their examples are shown below; save or discard your edits to refresh the catalog.
          </Text>
        </div>
      ) : null}

      <div className={d.tools}>
        <SearchField
          label="Search categories"
          placeholder="Search categories"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          width={240}
        />
        {canManage ? (
          adding ? (
            <form
              className={d.addForm}
              onSubmit={(e) => {
                e.preventDefault();
                addCategory();
              }}
            >
              <TextField label="New category name" hideLabel placeholder="New category" value={newName} onChange={setNewName} autoFocus />
              <Button size="sm" variant="accent" type="submit" isDisabled={!newName.trim()}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onPress={() => setAdding(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button size="sm" icon={<Icon name="plus" size={12} />} onPress={() => setAdding(true)}>
              Add category
            </Button>
          )
        ) : null}
      </div>

      {categories.length === 0 || !active ? (
        <EmptyState compact title="No categories yet" body="Add a category, or approve diagnoses in Reviews." />
      ) : (
        <Tabs
          label="Categories"
          orientation="vertical"
          className={d.catTabs}
          items={visible.map((c) => ({
            id: c.name,
            label: (
              <span className={d.catLabel}>
                <span>{c.name}</span>
                {c.exampleCount === 0 ? <Badge tone="warning">Needs examples</Badge> : null}
                {incomplete.has(c.name) ? <Badge tone="danger">Incomplete</Badge> : null}
              </span>
            ),
            count: c.exampleCount,
          }))}
          selected={active.name}
          onSelect={(id) => {
            setSelected(id);
            setSection('guidance');
          }}
        >
          <TabPanel id={active.name}>
            <div className={d.editor}>
              <div className={d.editorHead}>
                <Text variant="lg">{active.name}</Text>
                {canManage ? (
                  <Button size="sm" variant="danger" onPress={() => setRemoving(active.name)}>
                    Remove category
                  </Button>
                ) : null}
              </div>
              <Tabs
                label={`${active.name} sections`}
                selected={section}
                onSelect={setSection}
                items={[
                  { id: 'guidance', label: 'Guidance' },
                  { id: 'subs', label: 'Subcategories', count: active.subs.length },
                  { id: 'examples', label: 'Examples', count: active.exampleCount },
                ]}
              >
                <TabPanel id="guidance">
                  <div className={d.form}>
                    <Textarea
                      label="Description"
                      isRequired
                      rows={3}
                      isReadOnly={!canManage}
                      value={active.description}
                      onChange={(v) => editCategory(active.name, (c) => ({ ...c, description: v }))}
                      errorMessage={showProblems && !active.description.trim() ? 'Description is required.' : undefined}
                      isInvalid={showProblems && !active.description.trim()}
                    />
                    <Textarea
                      label="Use when"
                      isRequired
                      rows={3}
                      isReadOnly={!canManage}
                      value={active.whenToUse}
                      onChange={(v) => editCategory(active.name, (c) => ({ ...c, whenToUse: v }))}
                      errorMessage={showProblems && !active.whenToUse.trim() ? 'Use when is required.' : undefined}
                      isInvalid={showProblems && !active.whenToUse.trim()}
                    />
                  </div>
                </TabPanel>
                <TabPanel id="subs">
                  <div className={d.form}>
                    <div className={d.subTools}>
                      <SegmentedControl
                        label="Subcategory filter"
                        value={subFilter}
                        onChange={setSubFilter}
                        options={[
                          { value: 'all', label: 'All' },
                          { value: 'approved', label: 'Approved only' },
                        ]}
                      />
                      {canManage ? (
                        <form
                          className={d.addForm}
                          onSubmit={(e) => {
                            e.preventDefault();
                            addSub();
                          }}
                        >
                          <TextField label="New subcategory name" hideLabel placeholder="New subcategory" value={newSub} onChange={setNewSub} />
                          <Button size="sm" type="submit" icon={<Icon name="plus" size={12} />} isDisabled={!newSub.trim()}>
                            Add subcategory
                          </Button>
                        </form>
                      ) : null}
                    </div>
                    {subsShown.length ? (
                      <ul className={d.subList}>
                        {subsShown.map((x) => (
                          <li key={x.name} className={d.sub}>
                            <div className={d.subHead}>
                              <Text variant="md" weight={600}>
                                {x.name}
                              </Text>
                              {x.exampleOnly ? (
                                <Tag kind="data">example only</Tag>
                              ) : x.isNew ? (
                                <Tag kind="data" tone="info">
                                  new
                                </Tag>
                              ) : null}
                              <span className={s.spacer} />
                              {canManage && !x.exampleOnly ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Remove subcategory ${x.name}`}
                                  onPress={() => editCategory(active.name, (c) => ({ ...c, subs: c.subs.filter((y) => y.name !== x.name) }))}
                                >
                                  <Icon name="trash" size={12} />
                                </Button>
                              ) : null}
                            </div>
                            {x.exampleOnly ? (
                              <Text variant="sm" tone="muted">
                                Seen only in approved examples. It is not part of the saved catalog.
                              </Text>
                            ) : (
                              <>
                                <Textarea
                                  label="Description"
                                  rows={2}
                                  isReadOnly={!canManage}
                                  value={x.description}
                                  onChange={(v) => editSub(active.name, x.name, { description: v })}
                                />
                                <Textarea
                                  label="Use when"
                                  rows={2}
                                  isReadOnly={!canManage}
                                  value={x.whenToUse}
                                  onChange={(v) => editSub(active.name, x.name, { whenToUse: v })}
                                />
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState compact title="No subcategories" body="Add one, or approve diagnoses in Reviews." />
                    )}
                  </div>
                </TabPanel>
                <TabPanel id="examples">
                  {active.examples.length ? (
                    <ul className={d.exampleList}>
                      {active.examples.map((x) => {
                        const issues = rootCauseIssues({ root_cause_issues: x.root_cause_issues, root_cause_detail: x.detail });
                        return (
                          <li key={x.id}>
                            <details className={d.example}>
                              <summary>
                                <span className={d.mono}>{x.item_id ?? `#${x.id}`}</span>
                                {x.metric_name ? <Tag kind="data">{x.metric_name}</Tag> : null}
                                <span>{issues[0]?.finding || x.note || x.detail || 'Approved correction'}</span>
                              </summary>
                              <dl className={d.exampleBody}>
                                {(
                                  [
                                    ['Input', x.input],
                                    ['Expected', x.expected],
                                    ['Output', x.output],
                                    ['Note', x.note],
                                  ] as const
                                )
                                  .filter(([, v]) => v != null && v !== '')
                                  .map(([label, v]) => (
                                    <div key={label}>
                                      <dt>{label}</dt>
                                      <dd dir="auto">{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</dd>
                                    </div>
                                  ))}
                              </dl>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <EmptyState
                      compact
                      title="Needs examples"
                      body="Approve diagnoses for this category in Reviews. Categories without approved examples are still saved."
                    />
                  )}
                </TabPanel>
              </Tabs>
            </div>
          </TabPanel>
        </Tabs>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove category?"
        description={removing ? `${removing} and its subcategory guidance leave the catalog when you save.` : undefined}
        tone="danger"
        confirmLabel="Remove category"
        onConfirm={() => {
          if (removing) edit((v) => ({ ...v, categories: v.categories.filter((c) => c.name !== removing) }));
          setRemoving(null);
          setSelected(null);
        }}
      />
    </div>
  );
}
