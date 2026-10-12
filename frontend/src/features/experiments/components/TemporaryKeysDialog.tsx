/**
 * Key re-entry for a retry whose temporary models were saved without their API keys
 * (422 `temporary_key_required`). One password field per listed slot. The values live
 * only in this component's state: they are handed to `onSubmit` once and wiped on every
 * way out, never written to the DOM as attributes, the URL, storage or logs.
 */
import { useState } from 'react';
import type { TemporaryKeySlot } from '@/api/experiments';
import { Button, Dialog, TextField } from '@/ui';
import styles from './TemporaryKeysDialog.module.css';

export interface TemporaryKeysDialogProps {
  open: boolean;
  slots: TemporaryKeySlot[];
  onSubmit: (keys: Record<string, string>) => void;
  onCancel: () => void;
  /** Secondary action: leave and start a new experiment from this one instead. */
  onClone?: () => void;
}

export function TemporaryKeysDialog({ open, ...rest }: TemporaryKeysDialogProps) {
  // Unmounting the inner dialog drops its state, so closed means no key anywhere.
  return open ? <KeysForm {...rest} /> : null;
}

function KeysForm({ slots, onSubmit, onCancel, onClone }: Omit<TemporaryKeysDialogProps, 'open'>) {
  const [values, setValues] = useState<Record<string, string>>({});
  const complete = slots.length > 0 && slots.every((s) => (values[s.slot_key] ?? '').trim() !== '');

  function leave(action: () => void) {
    setValues({});
    action();
  }
  function submit() {
    if (!complete) return;
    const keys = Object.fromEntries(slots.map((s) => [s.slot_key, (values[s.slot_key] ?? '').trim()]));
    setValues({});
    onSubmit(keys);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) leave(onCancel);
      }}
      title="Enter API keys to retry"
      description="This experiment uses temporary models. Their keys are never stored, so enter them again for this retry. Each key is sent once and then discarded."
      dismissOnBackdrop={false}
      data-testid="temporary-keys-dialog"
      footer={
        <>
          <Button variant="neutral" size="md" onPress={() => leave(onCancel)}>
            Cancel
          </Button>
          {onClone ? (
            <Button variant="neutral" size="md" onPress={() => leave(onClone)}>
              Clone instead
            </Button>
          ) : null}
          <Button variant="primary" size="md" isDisabled={!complete} onPress={submit}>
            Retry with keys
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {slots.map((slot, i) => (
          <TextField
            key={slot.slot_key}
            label={slot.label || slot.slot_key}
            type="password"
            autoComplete="off"
            autoFocus={i === 0}
            isRequired
            value={values[slot.slot_key] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [slot.slot_key]: v }))}
            help={[slot.model, slot.base_url].filter(Boolean).join(' · ') || slot.slot_key}
            mono
          />
        ))}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
