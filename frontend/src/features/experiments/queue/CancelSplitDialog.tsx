/**
 * Split cancel confirmation (brief 06 §2.8): sections for what is removed here, what is
 * hard-stopped on the service and what is skipped, plus an optional reason (<= 1000).
 * Built on the shared Dialog so focus is trapped; initial focus is "Keep jobs".
 */
import { useRef, useState } from 'react';
import { Button, Dialog, Textarea } from '@/ui';
import type { SplitSection } from './lib';
import styles from './CancelSplitDialog.module.css';

export interface CancelSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string[];
  sections: SplitSection[];
  /** Number of jobs the confirm button will act on; 0 disables it. */
  actionable: number;
  confirmLabel: string;
  keepLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function CancelSplitDialog(props: CancelSplitDialogProps) {
  // Remount per open so the reason resets.
  return <Inner key={props.open ? 'open' : 'closed'} {...props} />;
}

function Inner({
  open,
  onOpenChange,
  title,
  description,
  sections,
  actionable,
  confirmLabel,
  keepLabel = 'Keep jobs',
  onConfirm,
}: CancelSplitDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      role="alertdialog"
      initialFocus={keepRef}
      data-testid="cancel-split-dialog"
      footer={
        <>
          <Button ref={keepRef} variant="neutral" onPress={() => onOpenChange(false)}>
            {keepLabel}
          </Button>
          <Button
            variant="danger"
            isDisabled={actionable === 0}
            loading={busy}
            data-testid="cancel-split-confirm"
            onPress={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setBusy(false);
                onOpenChange(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {(description ?? []).map((line) => (
          <p key={line} className={styles.lead}>
            {line}
          </p>
        ))}
        {sections.length === 0 ? <p className={styles.lead}>Nothing here can be cancelled.</p> : null}
        {sections.map((section) => (
          <section
            key={section.key}
            className={styles.split}
            data-skip={section.skip ? '' : undefined}
            data-split={section.key}
            aria-label={section.title}
          >
            <h3 className={styles.splitTitle}>
              {section.title} · {section.items.length}
            </h3>
            <p className={styles.splitBody}>{section.body}</p>
            <ul className={styles.list}>
              {section.items.slice(0, 5).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {section.items.length > 5 ? <li>… and {section.items.length - 5} more</li> : null}
            </ul>
          </section>
        ))}
        {actionable > 0 ? (
          <Textarea
            label="Reason (optional)"
            placeholder="Why are you cancelling?"
            value={reason}
            onChange={(v) => setReason(v.slice(0, 1000))}
            rows={3}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
