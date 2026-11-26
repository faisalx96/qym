import { useState } from 'react';
import { formatTableDate } from '@/lib/dates';
import {
  useHandOffPlatformSessionCookie,
  useSavePlatformSessionCookie,
  type PlatformTarget,
  type PlatformTokenHint,
} from '@/api/performancePlatform';
import { Button, Dialog, InlineNotice, StateTag, TextField, UserName } from '@/ui';
import { COOKIE_INSTRUCTIONS, signInError, platformCount } from './words';
import styles from './platform.module.css';

export function SessionDialog(props: {
  slug: string;
  targetId: string;
  runId?: string;
  onClose: () => void;
  onSaved?: (hint: PlatformTokenHint) => void;
  onHandedOff?: (version: number) => void;
}) {
  return <SessionBody {...props} />;
}
function SessionBody({
  slug,
  targetId,
  runId,
  onClose,
  onSaved,
  onHandedOff,
}: {
  slug: string;
  targetId: string;
  runId?: string;
  onClose: () => void;
  onSaved?: (hint: PlatformTokenHint) => void;
  onHandedOff?: (version: number) => void;
}) {
  const [cookie, setCookie] = useState('');
  const [error, setError] = useState<string>();
  const save = useSavePlatformSessionCookie(slug);
  const handoff = useHandOffPlatformSessionCookie(slug, runId ?? '', onHandedOff);
  const busy = save.isPending || handoff.isPending;
  async function submit() {
    const token = cookie;
    setCookie('');
    setError(undefined);
    try {
      if (runId) {
        await handoff.mutateAsync({ name: 'session_cookie', token, expires_at: null });
      } else {
        const hint = await save.mutateAsync({ targetId, body: { token, expires_at: null } });
        onSaved?.(hint);
      }
      onClose();
    } catch (caught) {
      setError(signInError(caught));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setCookie('');
          onClose();
        }
      }}
      title="Save a new sign-in"
      footer={
        <>
          <Button onPress={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            isDisabled={!cookie.trim() || busy}
            disabledReason="Paste the Cookie header first"
            onPress={() => void submit()}
          >
            Save sign-in
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        {runId ? (
          <InlineNotice tone="warning">Sign-in needed. Paste a new session cookie to continue.</InlineNotice>
        ) : null}
        <TextField
          label="Cookie header"
          type="password"
          autoComplete="off"
          value={cookie}
          onChange={setCookie}
          isDisabled={busy}
          isRequired
          help={COOKIE_INSTRUCTIONS}
          errorMessage={error}
        />
        <p className={styles.note}>
          The value is hidden after saving. All users in the run share this sign-in.
        </p>
      </div>
    </Dialog>
  );
}
export function sessionCount(hint: string): string {
  const count = /^(\d+) cookies?(?:,|$)/i.exec(hint.trim())?.[1];
  return count == null ? 'Saved' : platformCount(Number(count), 'cookie');
}
export function SessionHint({ token }: { token: PlatformTokenHint }) {
  return (
    <span>
      {sessionCount(token.hint)} · {token.updated_by ? 'saved' : 'renewed'}{' '}
      <span className={styles.number}>{formatTableDate(token.updated_at)}</span> by{' '}
      {token.updated_by ? <UserName id={token.updated_by_user_id} name={token.updated_by} /> : 'the runner'}
    </span>
  );
}
export function PlatformSignIn({
  slug,
  target,
  encryptionReady = true,
}: {
  slug: string;
  target: PlatformTarget;
  encryptionReady?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [savedHint, setSavedHint] = useState<PlatformTokenHint | null>(null);
  const ready = savedHint ? !savedHint.expired : target.sign_in_ready;
  const token = savedHint ?? target.tokens.find((item) => item.name === 'session_cookie');
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <strong>Sign-in</strong>
        <StateTag tone={ready ? 'success' : 'warning'}>
          {ready ? 'Saved' : token?.expired ? 'Expired' : 'Needed'}
        </StateTag>
      </div>
      {token ? (
        <p className={styles.note}>
          <SessionHint token={token} />
        </p>
      ) : null}
      {target.can_save_tokens && encryptionReady ? (
        <div>
          <Button onPress={() => setOpen(true)}>{token ? 'Replace sign-in' : 'Save sign-in'}</Button>
        </div>
      ) : null}
      {!encryptionReady ? (
        <InlineNotice tone="warning">
          Sign-in cannot be saved until the platform encryption key is set.
        </InlineNotice>
      ) : null}
      {open ? (
        <SessionDialog
          slug={slug}
          targetId={target.id}
          onSaved={setSavedHint}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
