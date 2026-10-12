/** Item → History tab: per-version revisions with word diffs; "Revert to this" on drafts (full-body PATCH). */
import { useState } from 'react';
import { useItemLineage, usePatchItem, type Dataset, type DatasetItem, type DatasetVersion, type ItemRevision } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Skeleton, Tag, Text, useToast } from '@/ui';
import { FieldDiff } from '../components/FieldDiff';
import { UserPill } from '../components/UserPill';
import { VersionBadge } from '../components/VersionSwitcher';
import { formatDate, sameValue, storedType } from '../lib/itemValue';
import styles from './ItemHistoryTab.module.css';

const FIELDS: { key: 'input' | 'expected_output' | 'metadata' | 'labels'; label: string }[] = [
  { key: 'input', label: 'input' },
  { key: 'expected_output', label: 'expected' },
  { key: 'metadata', label: 'metadata' },
  { key: 'labels', label: 'labels' },
];

export function ItemHistoryTab({ slug, dataset, version, item, editable }: { slug: string; dataset: Dataset; version: DatasetVersion; item: DatasetItem; editable: boolean }) {
  const query = useItemLineage(slug, dataset.slug, version.version, item.item_id);
  const showSkeleton = useDelayedPending(query.isPending);
  const patch = usePatchItem(slug, dataset.slug, version.version);
  const toast = useToast();
  const [revert, setRevert] = useState<ItemRevision | null>(null);

  if (showSkeleton) return <Skeleton kind="list" rows={3} label="Loading history" />;
  if (query.isError) return <ErrorState error={query.error} title="Couldn’t load the item history" onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  if (!query.data.lineage.length) return <EmptyState compact title="No history recorded" />;

  return (
    <div className={styles.wrap} data-item-history>
      {query.data.lineage.map(({ version: v, revisions }) => (
        <section key={v.id} className={styles.versionCard} aria-label={`${v.version} revisions`}>
          <header className={styles.versionHead}>
            <span className={styles.versionLabel}>{v.version}</span>
            <VersionBadge version={v} />
            <UserPill user={v.created_by} label="Drafted By:" />
            <span className={styles.when}>{formatDate(v.created_at)}</span>
          </header>
          {revisions.length ? (
            <ol className={styles.revisions}>
              {revisions.map((r) => {
                const changed = FIELDS.filter((f) => r.change_type === 'updated' ? !sameValue(r.before?.[f.key], r.after?.[f.key]) : true);
                const typeChanged = FIELDS.filter((f) => r.before && r.after && storedType(r.before[f.key]) !== storedType(r.after[f.key]));
                return (
                  <li key={r.id} className={styles.revision} data-revision={r.revision_number}>
                    <div className={styles.revHead}>
                      <Badge tone={r.change_type === 'created' ? 'success' : r.change_type === 'deleted' ? 'danger' : 'warning'}>{r.change_type}</Badge>
                      <Tag kind="count">#{r.revision_number}</Tag>
                      <UserPill user={r.actor ?? (r.actor_email ? { id: r.actor_user_id ?? '', email: r.actor_email, display_name: r.actor_name ?? r.actor_email } : null)} label="Edited By:" />
                      <span className={styles.when}>{formatDate(r.created_at)}</span>
                      {typeChanged.length ? (
                        <Text as="span" variant="sm" tone="warning">
                          type changed: {typeChanged.map((f) => `${f.label} ${storedType(r.before?.[f.key])} → ${storedType(r.after?.[f.key])}`).join(', ')}
                        </Text>
                      ) : null}
                      {editable && v.id === version.id && r.change_type !== 'deleted' && r.after ? (
                        <Button variant="ghost" size="sm" onPress={() => setRevert(r)} data-testid={`revert-${r.revision_number}`}>
                          ↩ Revert to this
                        </Button>
                      ) : null}
                    </div>
                    <div className={styles.diffs}>
                      {changed.map((f) => (
                        <FieldDiff key={f.key} field={f.label} before={r.before?.[f.key]} after={r.after?.[f.key]} onlyAfter={r.change_type === 'created'} onlyBefore={r.change_type === 'deleted'} />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Text variant="sm" tone="muted">
              No direct edits recorded in this version.
            </Text>
          )}
        </section>
      ))}
      <ConfirmDialog
        open={revert !== null}
        onOpenChange={(o) => !o && setRevert(null)}
        title={`Revert to revision #${revert?.revision_number ?? ''}?`}
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
            toast.show(`Reverted to revision #${revert.revision_number}`, { tone: 'success' });
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
