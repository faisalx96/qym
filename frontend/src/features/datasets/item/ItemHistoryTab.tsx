/**
 * Item → History tab: per-version revisions with word diffs, newest first; "Revert to this" on drafts (full-body PATCH),
 * except on the newest revision, which is the item as it is now (C189).
 */
import { useState } from 'react';
import {
  useItemLineage,
  usePatchItem,
  type Dataset,
  type DatasetItem,
  type DatasetVersion,
  type ItemRevision,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Text,
  Timeline,
  useToast,
  type TimelineItem,
} from '@/ui';
import { FieldDiff } from '../components/FieldDiff';
import { UserPill } from '../components/UserPill';
import { VersionBadge } from '../components/VersionSwitcher';
import { orderItemHistory, showsTypeChange } from '../lib/itemHistory';
import { formatDate, sameValue, storedType } from '../lib/itemValue';
import { formatTableDate } from '@/lib/dates';
import styles from './ItemHistoryTab.module.css';

/** The rail mark of a revision (cv5 Z6): a tone only for a removal (danger) or a disable (warning). */
const REVISION_MARK: Record<ItemRevision['change_type'], Pick<TimelineItem, 'icon' | 'tone'>> = {
  created: { icon: 'plus' },
  updated: { icon: 'edit' },
  deleted: { icon: 'trash', tone: 'danger' },
  disabled: { icon: 'ban', tone: 'warning' },
  enabled: { icon: 'check' },
};

const FIELDS: { key: 'input' | 'expected_output' | 'metadata' | 'labels'; label: string }[] = [
  { key: 'input', label: 'input' },
  { key: 'expected_output', label: 'expected' },
  { key: 'metadata', label: 'metadata' },
  { key: 'labels', label: 'labels' },
];

export function ItemHistoryTab({
  slug,
  dataset,
  version,
  item,
  editable,
}: {
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  item: DatasetItem;
  editable: boolean;
}) {
  const query = useItemLineage(slug, dataset.slug, version.version, item.item_id);
  const showSkeleton = useDelayedPending(query.isPending);
  const patch = usePatchItem(slug, dataset.slug, version.version);
  const toast = useToast();
  const [revert, setRevert] = useState<ItemRevision | null>(null);

  if (showSkeleton) return <Skeleton kind="list" rows={3} label="Loading history" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title="Couldn’t load the item history"
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return null;
  if (!query.data.lineage.length) return <EmptyState compact title="No history recorded" />;
  const { lineage, numberOf } = orderItemHistory(query.data.lineage);
  const current = lineage.find((l) => l.version.id === version.id);
  const newestId = current?.revisions[0]?.id;
  const num = (r: ItemRevision) => numberOf.get(r.id) ?? r.revision_number;

  // cv5 Z6: one Timeline, newest first, as the dataset Change log: each revision (its diff under it, Revert at the
  // end of its line), then the event that drafted its version
  const items: TimelineItem[] = lineage.flatMap(({ version: v, revisions }) => [
    ...revisions.map((r): TimelineItem => {
      const stateChange = r.change_type === 'disabled' || r.change_type === 'enabled';
      const changed = stateChange
        ? []
        : FIELDS.filter((f) =>
            r.change_type === 'updated' ? !sameValue(r.before?.[f.key], r.after?.[f.key]) : true,
          );
      const typeChanged = showsTypeChange(r)
        ? FIELDS.filter(
            (f) => r.before && r.after && storedType(r.before[f.key]) !== storedType(r.after[f.key]),
          )
        : [];
      const actor =
        r.actor ??
        (r.actor_email
          ? { id: r.actor_user_id ?? '', email: r.actor_email, display_name: r.actor_name ?? r.actor_email }
          : null);
      const canRevert =
        editable &&
        v.id === version.id &&
        r.id !== newestId &&
        r.change_type !== 'deleted' &&
        !stateChange &&
        r.after;
      return {
        key: `r${r.id}`,
        rowData: {
          'data-revision': String(r.revision_number),
          'data-testid': stateChange ? `rev-${r.change_type}` : undefined,
        },
        time: formatTableDate(r.created_at),
        timeTitle: formatDate(r.created_at),
        dateTime: r.created_at,
        ...REVISION_MARK[r.change_type],
        title: (
          <span>
            <span className={styles.key}>#{num(r)}</span> {r.change_type}
            {r.change_type === 'updated' && changed.length ? ` ${changed.map((f) => f.label).join(', ')}` : ''}
          </span>
        ),
        meta: <UserPill user={actor} />,
        detail: (
          <span className={styles.body}>
            {typeChanged.length ? (
              <Text as="span" variant="sm" tone="warning">
                type changed:{' '}
                {typeChanged
                  .map((f) => `${f.label} ${storedType(r.before?.[f.key])} → ${storedType(r.after?.[f.key])}`)
                  .join(', ')}
              </Text>
            ) : null}
            {stateChange ? (
              <Text variant="base" tone="secondary" as="span" className={styles.reasonText}>
                {r.change_type === 'disabled' && r.after?.reason?.trim()
                  ? `Reason: ${r.after.reason.trim()}`
                  : 'No reason given'}
              </Text>
            ) : null}
            {changed.map((f) => (
              <FieldDiff
                key={f.key}
                field={f.label}
                before={r.before?.[f.key]}
                after={r.after?.[f.key]}
                onlyAfter={r.change_type === 'created'}
                onlyBefore={r.change_type === 'deleted'}
              />
            ))}
          </span>
        ),
        actions: canRevert ? (
          <Button
            variant="neutral"
            size="sm"
            onPress={() => setRevert(r)}
            data-testid={`revert-${r.revision_number}`}
          >
            ↩ Revert to this
          </Button>
        ) : undefined,
      };
    }),
    {
      key: `v${v.id}`,
      time: formatTableDate(v.created_at),
      timeTitle: formatDate(v.created_at),
      dateTime: v.created_at,
      icon: 'plus',
      title: (
        <span className={styles.versionTitle}>
          <span>
            <span className={styles.key}>{v.version}</span> drafted
          </span>
          <VersionBadge version={v} />
        </span>
      ),
      meta: <UserPill user={v.created_by} />,
    },
  ]);

  return (
    <div data-item-history>
      <Card>
        <Timeline aria-label="Item history" markAlign="start" items={items} />
      </Card>
      <ConfirmDialog
        open={revert !== null}
        onOpenChange={(o) => !o && setRevert(null)}
        title={`Revert to revision #${revert ? num(revert) : ''}?`}
        description="Input, expected output, metadata and labels are replaced by the values saved in that revision. This creates a new revision."
        confirmLabel="Revert"
        tone="accent"
        onConfirm={async () => {
          if (!revert?.after) return;
          try {
            await patch.mutateAsync({
              itemId: item.item_id,
              body: {
                input: revert.after.input,
                expected_output: revert.after.expected_output ?? null,
                metadata: (revert.after.metadata ?? {}) as Record<string, unknown>,
                labels: revert.after.labels ?? [],
              },
            });
            toast.show(`Reverted to revision #${num(revert)}`, { tone: 'success' });
            setRevert(null);
          } catch (e) {
            toast.show(e instanceof ApiError ? e.detail || e.message : 'Revert failed', { tone: 'error' });
            throw e;
          }
        }}
      />
    </div>
  );
}
