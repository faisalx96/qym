/** Reviews dialogs: comment (approve/reject, Ctrl/⌘+Enter confirms), shortcuts help, bulk conflict alertdialog. */
import { useState } from 'react';
import { Button, Dialog, Kbd, Textarea } from '@/ui';
import { SHORTCUTS } from './lib/useQueueKeys';
import styles from './dialogs.module.css';

export interface CommentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: (comment: string) => Promise<void> | void;
}

export function CommentDialog(props: CommentDialogProps) {
  // Remount per open so the comment/busy state resets.
  return props.open ? <CommentInner key="open" {...props} /> : null;
}

function CommentInner({ open, onOpenChange, title, description, confirmLabel, tone = 'primary', onConfirm }: CommentDialogProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(comment.trim());
      onOpenChange(false);
    } catch {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onPress={() => void submit()} loading={busy} data-testid="comment-confirm">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea
        label="Comment (optional)"
        value={comment}
        onChange={setComment}
        rows={4}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          } else {
            // React Aria stops propagation for handled keys; Escape must still reach the dialog.
            e.continuePropagation();
          }
        }}
        help="Ctrl/⌘ + Enter confirms."
      />
    </Dialog>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="sm">
      <dl className={styles.keys}>
        {SHORTCUTS.map((s) => (
          <div key={s.label} className={styles.keyRow}>
            <dt>
              {s.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 ? ' ' : null}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </dt>
            <dd>{s.label}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

/** Bulk 409: the selection no longer matches the server; the only way forward is reload + reselect. */
export function ConflictDialog({ detail, onReload }: { detail: string | null; onReload: () => void }) {
  return (
    <Dialog
      open={detail !== null}
      onOpenChange={(o) => !o && onReload()}
      role="alertdialog"
      title="The list changed"
      description={detail ?? ''}
      dismissOnBackdrop={false}
      hideClose
      footer={
        <Button variant="primary" onPress={onReload} data-testid="conflict-reload">
          Reload and select again
        </Button>
      }
    >
      <p className={styles.conflictNote}>Another reviewer decided some of these corrections after you selected them. Nothing was changed.</p>
    </Dialog>
  );
}
