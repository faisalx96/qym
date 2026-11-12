import { Button, CopyButton, Dialog, Stack, Text } from '@/ui';
import styles from './SecretRevealDialog.module.css';

export interface SecretRevealDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  secret: string | null;
  /** e.g. "API key", "Dataset read token", "Temporary password" */
  noun: string;
  description?: string;
}

/**
 * Shows a one-time secret (API key, read token, temporary password) with Copy. Only Done or the
 * × button closes it: a stray click outside or Escape would lose a secret that shows once (C045).
 */
export function SecretRevealDialog({
  open,
  onClose,
  title,
  secret,
  noun,
  description,
}: SecretRevealDialogProps) {
  return (
    <Dialog
      open={open && secret !== null}
      onOpenChange={(o) => !o && onClose()}
      dismissOnBackdrop={false}
      isKeyboardDismissDisabled
      title={title}
      description={description ?? `Copy this ${noun} now. It is shown once and cannot be retrieved later.`}
      footer={
        <Button variant="primary" size="md" onPress={onClose}>
          Done
        </Button>
      }
    >
      <Stack gap="sm">
        <Text variant="sm" as="label" htmlFor="secret-reveal">
          {noun}
        </Text>
        <div className={styles.row}>
          <input
            id="secret-reveal"
            className={styles.secret}
            readOnly
            value={secret ?? ''}
            onFocus={(e) => e.target.select()}
            data-secret
          />
          <CopyButton text={secret ?? ''} label={`Copy ${noun}`} />
        </div>
      </Stack>
    </Dialog>
  );
}
