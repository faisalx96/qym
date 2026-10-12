import { useRef, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { TextField } from '../TextField';
import styles from './ConfirmDialog.module.css';

export interface ConfirmWarning {
  lead?: string;
  text?: string;
  items?: { title: string; meta?: string }[];
  more?: number;
  itemsLabel?: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | string[];
  warning?: string | ConfirmWarning;
  note?: ReactNode;
  /** Typed confirmation: the primary stays disabled until the input matches. */
  requireText?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  mismatchMessage?: string;
  cancelLabel?: string;
  altLabel?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'accent';
  onConfirm: () => Promise<void> | void;
  onAlternative?: () => Promise<void> | void;
  onCancel?: () => void;
}

/** Confirm flow (shell.js openConfirmDialog). Destructive dialogs open focused on Cancel. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  // Remount on every open so typed text / errors reset without effects.
  return <ConfirmDialogInner key={props.open ? 'open' : 'closed'} {...props} />;
}

function ConfirmDialogInner({
  open,
  onOpenChange,
  title,
  description,
  warning,
  note,
  requireText,
  inputLabel = 'Type to confirm',
  inputPlaceholder,
  mismatchMessage = 'The text does not match.',
  cancelLabel = 'Cancel',
  altLabel,
  confirmLabel = 'Confirm',
  tone = 'accent',
  onConfirm,
  onAlternative,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = !requireText || typed.trim() === requireText;
  const lines = Array.isArray(description) ? description : description ? [description] : [];
  const warn: ConfirmWarning | null = typeof warning === 'string' ? { text: warning } : (warning ?? null);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel?.();
        onOpenChange(o);
      }}
      title={title}
      role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      initialFocus={tone === 'danger' ? cancelRef : undefined}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="neutral"
            size="md"
            onPress={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            isDisabled={busy}
          >
            {cancelLabel}
          </Button>
          {altLabel && onAlternative ? (
            <Button variant="neutral" size="md" onPress={() => run(onAlternative)} isDisabled={busy}>
              {altLabel}
            </Button>
          ) : null}
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="md"
            onPress={() => run(onConfirm)}
            isDisabled={!matches || busy}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        {lines.map((line, i) => (
          <p key={i} className={styles.line}>
            {line}
          </p>
        ))}
        {warn ? (
          <div className={styles.warning} data-tone={tone}>
            {warn.lead ? <strong>{warn.lead}</strong> : null}
            {warn.text ? <p className={styles.line}>{warn.text}</p> : null}
            {warn.items?.length ? (
              <>
                {warn.itemsLabel ? <div className={styles.itemsLabel}>{warn.itemsLabel}</div> : null}
                <ul className={styles.items}>
                  {warn.items.map((item, i) => (
                    <li key={i}>
                      <span>{item.title}</span>
                      {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
                    </li>
                  ))}
                  {warn.more ? <li className={styles.meta}>+{warn.more} more</li> : null}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        {note ? <div className={styles.note}>{note}</div> : null}
        {requireText ? (
          <TextField
            label={inputLabel}
            value={typed}
            onChange={setTyped}
            placeholder={inputPlaceholder ?? requireText}
            mono
            autoFocus={tone !== 'danger'}
            errorMessage={typed && !matches ? mismatchMessage : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches && !busy) {
                e.preventDefault();
                void run(onConfirm);
                return;
              }
              // React Aria stops keyboard propagation by default; let Escape reach the overlay.
              e.continuePropagation();
            }}
          />
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
