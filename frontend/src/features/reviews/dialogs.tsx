/** Reviews dialogs: comment (approve/reject, Ctrl/⌘+Enter confirms), shortcuts help, bulk conflict alertdialog. */
import { useState } from 'react';
import { useSingleKeyShortcuts } from '@/features/runs-list/useRunsKeyboard';
import { Button, Dialog, Kbd, Switch, Text, Textarea } from '@/ui';
import { SHORTCUTS } from './lib/useQueueKeys';
import styles from './dialogs.module.css';

export interface CommentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** A reject needs a comment (C250): the confirm button waits for one. */
  requireComment?: boolean;
  onConfirm: (comment: string) => Promise<void> | void;
}

export function CommentDialog(props: CommentDialogProps) {
  // Remount per open so the comment/busy state resets.
  return props.open ? <CommentInner key="open" {...props} /> : null;
}

function CommentInner({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  requireComment = false,
  onConfirm,
}: CommentDialogProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = requireComment && !comment.trim();
  async function submit() {
    if (busy || missing) return;
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
          <Button variant="neutral" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onPress={() => void submit()}
            loading={busy}
            isDisabled={missing}
            data-testid="comment-confirm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea
        label="Comment"
        isRequired={requireComment}
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

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [single, setSingle] = useSingleKeyShortcuts();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
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
      {/* the same opt-out as on Runs (C088, WCAG 2.1.4): it covers every page's letter keys */}
      <div className={styles.optout}>
        <Switch isSelected={single} onChange={setSingle}>
          Single-key shortcuts (j, k, a, r, e, o, x, /, ?)
        </Switch>
        <Text variant="sm" tone="muted" as="p">
          Turn off if they collide with assistive technology. Arrow keys, Enter and Esc keep working.
        </Text>
      </div>
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
      <p className={styles.conflictNote}>
        Another reviewer decided some of these issues after you selected them. Nothing was changed.
      </p>
    </Dialog>
  );
}
