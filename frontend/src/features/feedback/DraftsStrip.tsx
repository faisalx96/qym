import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Callout } from '@/features/experiments/launch/components/Callout';
import { useDeleteDraft, type FeedbackDraftRow } from '@/api/feedback';
import { Button, ConfirmDialog, useToast } from '@/ui';
import { ago } from './format';
import styles from './feedback.module.css';

/** The caller's drafts above the list (QE-7, QE-8). Drafts are never table rows. */
export function DraftsStrip({ drafts }: { drafts: FeedbackDraftRow[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeleteDraft();
  const [pending, setPending] = useState<FeedbackDraftRow | null>(null);
  if (!drafts.length) return null;
  const discard = async (d: FeedbackDraftRow) => {
    try {
      await del.mutateAsync(d.id);
      toast.show('Draft deleted', { tone: 'success' });
    } catch {
      toast.show('Couldn’t delete the draft.', { tone: 'error' });
    }
  };
  return (
    <>
      <Callout tone="info" title={`${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'} only you can see`}>
        <ul className={styles.drafts} data-testid="drafts-strip">
          {drafts.map((d) => {
            const title = d.title || 'Untitled draft';
            return (
              <li key={d.id}>
                <span className={styles.draftTitle}>{title}</span>
                <span className={styles.draftMeta}>
                  {d.subject === 'platform' ? 'Platform' : (d.project?.name ?? 'A product')} · {d.message_count}{' '}
                  {d.message_count === 1 ? 'message' : 'messages'} · {ago(d.last_activity_at)} · deleted in {d.days_left}{' '}
                  {d.days_left === 1 ? 'day' : 'days'}
                </span>
                <span className={styles.draftActions}>
                  <Button
                    size="sm"
                    variant="neutral"
                    aria-label={`Resume ${title}`}
                    onPress={() => navigate(`/feedback/${d.id}`)}
                  >
                    Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Discard ${title}`}
                    onPress={() => (d.message_count > 1 ? setPending(d) : void discard(d))}
                  >
                    Discard
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </Callout>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Delete this draft?"
        description="The conversation is deleted. This cannot be undone."
        confirmLabel="Delete draft"
        tone="danger"
        onConfirm={async () => {
          if (pending) await discard(pending);
          setPending(null);
        }}
      />
    </>
  );
}
