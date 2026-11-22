/**
 * One bookmark in a group's Notes view: the run (name as the link to its page, status, task / dataset / model tags),
 * the Public or Private flag, the note rendered from its markdown subset, and the author line. The author's own
 * bookmark carries its actions (edit or move, remove) while the project is not read-only; a card holds no other
 * interactive element than those, so it is a passive Card, not a pressable one.
 */
import { runPath } from '@/app/routes';
import type { Bookmark } from '@/api/bookmarks';
import { useModelIndex } from '@/api/dashboard';
import { modelSeriesOf } from '@/features/runs-list/model';
import { formatAgo } from '@/lib/dates';
import {
  Card,
  DatasetTag,
  Flag,
  IconButton,
  ModelTag,
  RunStatusBadge,
  TaskTag,
  TextBlock,
  TextLink,
  UserName,
  type RunStatus,
} from '@/ui';
import styles from './BookmarksPage.module.css';

export interface BookmarkCardProps {
  bookmark: Bookmark;
  slug: string;
  /** The caller may change this bookmark (their own, on a writable project). */
  canEdit: boolean;
  onEdit: (bookmark: Bookmark) => void;
  onRemove: (bookmark: Bookmark) => void;
  busy?: boolean;
}

export function runLabel(bookmark: Bookmark): string {
  return bookmark.run.external_run_id || bookmark.run.run_name || bookmark.run.run_id;
}

export function BookmarkCard({ bookmark, slug, canEdit, onEdit, onRemove, busy }: BookmarkCardProps) {
  const modelIndex = useModelIndex(slug);
  const run = bookmark.run;
  const name = runLabel(bookmark);
  return (
    <Card as="li" className={styles.entry} data-testid="bookmark-card" data-visibility={bookmark.visibility}>
      <div className={styles.head}>
        <div className={styles.title}>
          <TextLink to={runPath(slug, run.run_id)} arrow={false} className={styles.runLink}>
            <span dir="auto">{name}</span>
          </TextLink>
          {run.status ? <RunStatusBadge status={run.status as RunStatus} /> : null}
        </div>
        <div className={styles.flags}>
          {bookmark.visibility === 'public' ? (
            <Flag tone="success" icon="eye">
              Public
            </Flag>
          ) : (
            <Flag icon="lock">Private</Flag>
          )}
        </div>
      </div>
      <div className={styles.tags}>
        <TaskTag name={run.task} />
        <DatasetTag name={run.dataset} />
        {run.model ? (
          <ModelTag name={run.model} reasoning={false} series={modelSeriesOf(modelIndex, run.model, false)} />
        ) : null}
      </div>
      {bookmark.note ? (
        <TextBlock text={bookmark.note} mode="rendered" className={styles.note} />
      ) : (
        <p className={styles.noNote}>No note</p>
      )}
      <div className={styles.foot}>
        <span className={styles.author}>
          <UserName id={bookmark.user.id} name={bookmark.user.display_name} email={bookmark.user.email} />
          <span className={styles.when} title={bookmark.created_at ?? undefined}>
            {bookmark.created_at ? formatAgo(bookmark.created_at) : ''}
          </span>
        </span>
        {canEdit ? (
          <span className={styles.actions}>
            <IconButton
              label="Edit or move bookmark"
              icon="edit"
              tile
              isDisabled={busy}
              onPress={() => onEdit(bookmark)}
              data-testid="bookmark-edit"
            />
            <IconButton
              label="Remove bookmark"
              icon="trash"
              tile
              tone="danger"
              isDisabled={busy}
              onPress={() => onRemove(bookmark)}
              data-testid="bookmark-delete"
            />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
