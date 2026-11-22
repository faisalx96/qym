/**
 * Factory → Rules: the extracted and hand-written rules in a table (official first), with a search, category,
 * group and status filters, and the row actions: make official / take back (approve level), edit and remove
 * (modify level). Filters live in component state: the tab is one view of the factory page.
 */
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  useCreateRule,
  useDeleteRule,
  useFactoryRules,
  useSetRuleOfficial,
  useUpdateRule,
  type FactoryDetail,
  type FactoryRule,
  type RuleKindFilter,
  type RuleStatusFilter,
} from '@/api/factory';
import { formatAgo } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { tableLoading, useDelayedPending } from '@/lib/pending';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Icon,
  IconButton,
  SearchField,
  SegmentedControl,
  Select,
  StatusMark,
  Tag,
  Text,
  useToast,
  type Column,
} from '@/ui';
import { RuleDialog } from '../dialogs';
import styles from '../FactoryDetailPage.module.css';

const ALL = '__all';
const KINDS: { key: RuleKindFilter; label: string }[] = [
  { key: 'all', label: 'Rules and bridges' },
  { key: 'rule', label: 'Rules only' },
  { key: 'bridge', label: 'Bridges only' },
];
const STATUS: { value: RuleStatusFilter; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Official and proposed rules' },
  { value: 'official', label: 'Official', title: 'Rules a person approved' },
  { value: 'proposed', label: 'Proposed', title: 'Rules not approved yet' },
];

export function RulesTab({
  factory,
  canModify,
  canApprove,
  groups,
}: {
  factory: FactoryDetail;
  canModify: boolean;
  canApprove: boolean;
  groups: string[];
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<Key | null>(ALL);
  const [group, setGroup] = useState<Key | null>(ALL);
  const [kind, setKind] = useState<Key | null>('all');
  const [status, setStatus] = useState<RuleStatusFilter>('all');
  const filters = {
    q: q.trim(),
    category_id: category && category !== ALL ? String(category) : null,
    group: group && group !== ALL ? String(group) : null,
    kind: (kind ?? 'all') as RuleKindFilter,
    status,
  };
  const list = useFactoryRules(factory.id, filters);
  const showSkeleton = useDelayedPending(list.isPending);
  const create = useCreateRule(factory.id);
  const update = useUpdateRule(factory.id);
  const remove = useDeleteRule(factory.id);
  const official = useSetRuleOfficial(factory.id);
  const [editing, setEditing] = useState<FactoryRule | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FactoryRule | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const isFiltered = Boolean(
    filters.q || filters.category_id || filters.group !== null || filters.kind !== 'all' || status !== 'all',
  );
  const rules = list.data?.rules ?? [];

  async function toggleOfficial(rule: FactoryRule) {
    setActing(rule.id);
    try {
      await official.mutateAsync({ ruleId: rule.id, official: !rule.official });
      toast.show(rule.official ? 'Rule back to proposed' : 'Rule is official', { tone: 'success' });
    } catch (e) {
      toast.show(actionErrorMessage(rule.official ? 'take the rule back' : 'make the rule official', e), {
        tone: 'error',
      });
    } finally {
      setActing(null);
    }
  }

  const columns: Column<FactoryRule>[] = [
    {
      id: 'title',
      header: 'Rule',
      flex: true,
      minWidth: 280,
      priority: 1,
      cardTitle: true,
      cell: (r) => (
        <span dir="auto" data-testid="rule-title-cell">
          {r.title}
        </span>
      ),
      secondary: (r) => (r.description ? <span dir="auto">{r.description}</span> : null),
      wrap: true,
    },
    {
      id: 'status',
      header: 'Status',
      width: 120,
      priority: 1,
      cell: (r) =>
        r.official ? (
          <StatusMark tone="success" shape="check" label="Official" data-status="official" />
        ) : (
          <StatusMark tone="neutral" shape="dot" label="Proposed" data-status="proposed" />
        ),
    },
    {
      id: 'category',
      header: 'Categories',
      width: 220,
      priority: 2,
      wrap: true,
      cell: (r) => (
        <span className={styles.tagRow}>
          {(r.categories.length
            ? r.categories
            : [{ id: r.category_id, key: '', name: r.category_name ?? '—' }]
          ).map((c) => (
            <Tag key={c.id} kind="config">
              {c.name}
            </Tag>
          ))}
          {r.kind === 'bridge' ? (
            <Tag
              tone="accent"
              title="A bridge extends an item into these categories"
              data-testid="rule-bridge"
            >
              Bridge into {r.bridge_to.map((c) => c.name).join(', ') || '—'}
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      id: 'group',
      header: factory.group_metadata_key ? `Group (${factory.group_metadata_key})` : 'Group',
      width: 160,
      priority: 2,
      cell: (r) =>
        r.group_value ? (
          <Tag kind="dataset">{r.group_value}</Tag>
        ) : (
          <span className={styles.muted}>Every item</span>
        ),
    },
    {
      id: 'source',
      header: 'Source',
      width: 100,
      priority: 3,
      cell: (r) =>
        r.source === 'manual'
          ? 'Written'
          : `Agent${r.evidence.length ? ` · ${r.evidence.length} item${r.evidence.length === 1 ? '' : 's'}` : ''}`,
    },
    {
      id: 'added',
      header: 'Added',
      width: 130,
      priority: 3,
      cell: (r) => (r.created_at ? formatAgo(r.created_at) : '—'),
    },
    ...(canModify || canApprove
      ? [
          {
            id: 'actions',
            header: 'Actions',
            hideLabel: true,
            width: 110,
            priority: 1,
            cell: (r: FactoryRule) => (
              <span className={styles.rowActions}>
                {canApprove ? (
                  <IconButton
                    tile
                    tone={r.official ? 'reject' : 'approve'}
                    icon={r.official ? 'minus' : 'check'}
                    label={r.official ? `Take back “${r.title}”` : `Make “${r.title}” official`}
                    isDisabled={acting === r.id}
                    onPress={() => void toggleOfficial(r)}
                    data-testid={r.official ? 'rule-revoke' : 'rule-approve'}
                  />
                ) : null}
                {canModify ? (
                  <>
                    <IconButton
                      tile
                      icon="edit"
                      label={`Edit “${r.title}”`}
                      onPress={() => setEditing(r)}
                      data-testid="rule-edit"
                    />
                    <IconButton
                      tile
                      tone="danger"
                      icon="trash"
                      label={`Remove “${r.title}”`}
                      isDisabled={r.official && !canApprove}
                      disabledReason="An official rule is removed by someone with the approve level"
                      onPress={() => setRemoving(r)}
                      data-testid="rule-delete"
                    />
                  </>
                ) : null}
              </span>
            ),
          } satisfies Column<FactoryRule>,
        ]
      : []),
  ];

  return (
    <div className={styles.tab} data-testid="rules-tab">
      <div className={styles.toolbar}>
        <SearchField
          label="Search rules"
          hideLabel
          placeholder="Title or rule text"
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          shortcut="/"
        />
        <Select
          label="Category"
          hideLabel
          items={[
            { key: ALL, label: 'All categories' },
            ...factory.categories.map((c) => ({ key: c.id, label: c.name })),
          ]}
          value={category}
          onChange={setCategory}
          searchable={false}
          triggerVariant="bar"
          showValue="always"
        />
        <Select
          label="Group"
          hideLabel
          items={[
            { key: ALL, label: 'All groups' },
            ...groups.map((g) => ({ key: g, label: g || 'Every item' })),
          ]}
          value={group}
          onChange={setGroup}
          searchable="auto"
          triggerVariant="bar"
          showValue="always"
        />
        <Select
          label="Kind"
          hideLabel
          items={KINDS}
          value={kind}
          onChange={setKind}
          searchable={false}
          triggerVariant="bar"
          showValue="always"
        />
        <SegmentedControl<RuleStatusFilter>
          label="Rule status"
          value={status}
          onChange={setStatus}
          options={STATUS}
        />
        <span className={styles.toolbarEnd}>
          {list.data ? (
            <Text as="span" variant="sm" tone="muted" data-testid="rules-count">
              {list.data.total} rule{list.data.total === 1 ? '' : 's'}
            </Text>
          ) : null}
          {canModify ? (
            <Button
              variant="neutral"
              icon={<Icon name="plus" size={12} />}
              onPress={() => setAdding(true)}
              data-testid="add-rule"
            >
              Add rule
            </Button>
          ) : null}
        </span>
      </div>
      <DataTable<FactoryRule>
        aria-label="Rules"
        rows={rules}
        rowKey={(r) => r.id}
        columns={columns}
        density="comfortable"
        loading={tableLoading(list.isPending, showSkeleton)}
        refreshing={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        errorTitle="Couldn’t load the rules"
        isFiltered={isFiltered}
        filteredEmpty={
          <EmptyState
            compact
            title={filters.q ? `No rules match “${filters.q}”` : 'No rules match these filters'}
          />
        }
        empty={
          <EmptyState
            compact
            title="No rules yet"
            body={
              canModify
                ? 'Press Analyze rules to let the agent propose them, or add a rule by hand.'
                : 'No rule has been extracted or written yet.'
            }
          />
        }
        rowProps={(r) => ({ 'data-official': r.official ? '' : undefined })}
      />
      <RuleDialog
        open={adding || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        factory={factory}
        groups={groups}
        existing={editing}
        onSave={async (values) => {
          if (editing) {
            await update.mutateAsync({ ruleId: editing.id, body: values });
            toast.show('Rule saved', { tone: 'success' });
          } else {
            await create.mutateAsync(values);
            toast.show('Rule added', { tone: 'success' });
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove the rule “${removing?.title ?? ''}”?`}
        description={
          removing?.official
            ? 'It is official: generated data will no longer apply it.'
            : 'The rule goes; the agent may propose it again at the next analysis.'
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.id);
            toast.show('Rule removed', { tone: 'info' });
            setRemoving(null);
          } catch (e) {
            toast.show(actionErrorMessage('remove the rule', e), { tone: 'error' });
          }
        }}
      />
    </div>
  );
}
