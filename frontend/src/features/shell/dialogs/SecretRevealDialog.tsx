import { Button, CopyButton, Dialog, Stack, Text, useToast } from '@/ui';
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

/** Shows a one-time secret (API key, read token, temporary password) with Copy. */
export function SecretRevealDialog({ open, onClose, title, secret, noun, description }: SecretRevealDialogProps) {
  const toast = useToast();
  return (
    <Dialog
      open={open && secret !== null}
      onOpenChange={(o) => !o && onClose()}
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
          <input id="secret-reveal" className={styles.secret} readOnly value={secret ?? ''} onFocus={(e) => e.target.select()} data-secret />
          <CopyButton text={secret ?? ''} label={`Copy ${noun}`} onCopied={() => toast.show(`${noun} copied`, { tone: 'success' })} />
        </div>
      </Stack>
    </Dialog>
  );
}
