/** New run, step 1: where the questions go (a target), and the sign-in the run uses there. */
import { useState } from 'react';
import type { PlatformTarget } from '@/api/performancePlatform';
import { TargetChoiceFacts } from '../platform/PlatformMarks';
import {
  useSavePerformanceTargetToken,
  type PerformanceSetup,
  type PerformanceSetupTarget,
  type PerformanceTokenHint,
} from '@/api/performance';
import { formatTableDate } from '@/lib/dates';
import { Button, Icon, InlineNotice, Skeleton, TextField, UserName } from '@/ui';
import { saveTokenErrorWords } from './errors';
import { span } from '../../lib/format';
import { OptionBox, OptionGroup, SignInTag } from './parts';
import styles from './newRun.module.css';

const MANAGER_ONLY = 'Only a project manager can add or change a target';
const ADD_ABOUT = 'Another environment: its name and its address.';
const TOKENS_NOTE =
  'Tokens can run out during a long run. The run page then asks for a new one, and the run carries on. A new sign-in by the same person in a browser ends the saved token.';

/** Where a saved token came from: a person saved it, or the runner reported a renewed one. */
function TokenLine({ token }: { token: PerformanceTokenHint }) {
  const when = <span className={styles.figures}>{formatTableDate(token.updated_at)}</span>;
  return (
    <span>
      {token.hint ? (
        <>
          Refresh token ends in <span className={styles.number}>{token.hint}</span>,{' '}
        </>
      ) : (
        'Refresh token, '
      )}
      {token.updated_by ? (
        <>
          saved {when} by <UserName id={token.updated_by_user_id} name={token.updated_by} />
        </>
      ) : (
        <>renewed {when} by the runner</>
      )}
      {token.expired ? '. It has run out.' : null}
    </span>
  );
}

/** Paste, save and replace the two tokens. A token is never shown again: only its last four characters. */
function SignIn({
  slug,
  target,
  encryptionReady,
}: {
  slug: string;
  target: PerformanceSetupTarget;
  encryptionReady: boolean;
}) {
  const [replacing, setReplacing] = useState(false);
  const [access, setAccess] = useState('');
  const [refresh, setRefresh] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useSavePerformanceTargetToken(slug);
  const token = target.tokens.find((item) => item.name === 'refresh_token');
  const usable = Boolean(token) && !token?.expired;
  const formOpen = target.can_save_tokens && encryptionReady && (!usable || replacing);
  // A write the person may not make, or cannot make yet, is disabled in place with the reason (DESIGN_LANGUAGE §3.1).
  const lockedReason = !target.can_save_tokens
    ? target.is_production
      ? 'Only a project manager can save the sign-in of a production target'
      : 'Only a Member or a Manager of this project can save tokens'
    : !encryptionReady
      ? 'Tokens cannot be stored until the platform’s encryption key is set'
      : undefined;

  const close = () => {
    setAccess('');
    setRefresh('');
    setReplacing(false);
    setError(null);
  };

  async function submit() {
    const refreshToken = refresh.trim();
    const accessToken = access.trim();
    if (!refreshToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The access token first: the refresh token is what makes the sign-in ready, so it is saved last.
      if (accessToken)
        await save.mutateAsync({ targetId: target.id, name: 'access_token', body: { token: accessToken } });
      await save.mutateAsync({ targetId: target.id, name: 'refresh_token', body: { token: refreshToken } });
      close();
    } catch (refused) {
      setError(saveTokenErrorWords(refused));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`${styles.row} ${styles.between}`}>
        <span className={styles.row}>
          <SignInTag target={target} />
          {token ? <TokenLine token={token} /> : <span>Paste both tokens to run against {target.name}.</span>}
        </span>
        {usable && !replacing ? (
          <Button
            onPress={() => setReplacing(true)}
            isDisabled={Boolean(lockedReason)}
            disabledReason={lockedReason}
          >
            Replace tokens
          </Button>
        ) : null}
      </div>
      {!target.can_save_tokens ? (
        <p className={styles.note}>
          {target.is_production
            ? 'Only a project manager can save the sign-in of a production target.'
            : 'You may not save tokens in this project. Ask a project manager for the Member role.'}
        </p>
      ) : !encryptionReady ? (
        <InlineNotice tone="warning" lead="Tokens cannot be stored yet.">
          The platform’s encryption key is not set. Ask the platform administrator.
        </InlineNotice>
      ) : null}
      {formOpen ? (
        <>
          <div className={styles.tokens}>
            <TextField
              label="Access token"
              type="password"
              mono
              autoComplete="off"
              value={access}
              onChange={setAccess}
              isDisabled={busy}
              placeholder="Paste the access token"
              help={`From the browser's developer tools: Network, the answer of the ${target.token_refresh_path} request, field access_token.`}
            />
            <TextField
              label="Refresh token"
              type="password"
              mono
              isRequired
              autoComplete="off"
              value={refresh}
              onChange={setRefresh}
              isDisabled={busy}
              placeholder="Paste the refresh token"
              help="From developer tools: Application, Cookies, the value of estishraf_rt."
            />
          </div>
          <div className={styles.row}>
            <Button
              variant="accent"
              onPress={() => void submit()}
              isDisabled={!refresh.trim()}
              disabledReason="Paste the refresh token first"
              loading={busy}
            >
              Save tokens
            </Button>
            {usable ? (
              <Button onPress={close} isDisabled={busy}>
                Keep the saved tokens
              </Button>
            ) : null}
            <span className={styles.muted}>
              Saved tokens stay masked: only the last four characters are shown.
            </span>
          </div>
          {error ? (
            <InlineNotice tone="danger" lead="Not saved.">
              {error}
            </InlineNotice>
          ) : null}
        </>
      ) : null}
      <p className={styles.note}>{TOKENS_NOTE}</p>
    </>
  );
}

export function TargetStep({
  slug,
  setup,
  target,
  onChoose,
  onAdd,
  onEdit,
  extraTargets = [],
}: {
  extraTargets?: PlatformTarget[];
  slug: string;
  setup: PerformanceSetup;
  target: PerformanceSetupTarget | null;
  onChoose: (id: string) => void;
  onAdd: () => void;
  onEdit: (target: PerformanceSetupTarget) => void;
}) {
  const manage = setup.can_manage_targets;
  return (
    <div className={styles.stack}>
      <OptionGroup label="Target" value={target?.id ?? null} onChange={onChoose}>
        {[...setup.targets, ...extraTargets].map((item) => (
          <OptionBox key={item.id} value={item.id} data-performance-target={item.id}>
            <TargetChoiceFacts target={item} />
          </OptionBox>
        ))}
        {/* Not a radio: its own tab stop after the group's. Disabled in place, with the reason, for a non-manager. */}
        <button
          type="button"
          className={styles.option}
          data-add=""
          data-performance-target="add"
          aria-disabled={manage ? undefined : 'true'}
          onClick={manage ? onAdd : undefined}
        >
          <span className={styles.optionTitle}>
            <Icon name="plus" size={12} />
            Add a target
          </span>
          <span>{manage ? ADD_ABOUT : `${ADD_ABOUT} ${MANAGER_ONLY}.`}</span>
        </button>
      </OptionGroup>
      {target ? (
        <div className={`${styles.stack} ${styles.rule}`} data-performance-block="sign-in">
          <div className={`${styles.row} ${styles.between}`}>
            <span className={styles.row}>
              <span className={styles.label}>Questions go to</span>
              <span className={styles.host}>
                {target.base_url}
                {target.chat_path}
              </span>
              {target.max_users ? (
                <span className={styles.muted}>At most {target.max_users} users</span>
              ) : null}
            </span>
            <Button
              icon={<Icon name="edit" size={12} />}
              onPress={() => onEdit(target)}
              isDisabled={!manage}
              disabledReason={MANAGER_ONLY}
            >
              Edit target
            </Button>
          </div>
          {/* One sign-in form per target: what was typed for one target never shows under another. */}
          {target.settings.auth_server ||
          target.settings.refresh_cookie_name ||
          target.max_duration_s != null ? (
            <dl className={styles.facts}>
              {target.settings.auth_server ? (
                <>
                  <dt>Sign-in server</dt>
                  <dd className={styles.host}>{target.settings.auth_server}</dd>
                </>
              ) : null}
              {target.settings.refresh_cookie_name ? (
                <>
                  <dt>Sign-in cookie name</dt>
                  <dd className={styles.host}>{target.settings.refresh_cookie_name}</dd>
                </>
              ) : null}
              {target.max_duration_s != null ? (
                <>
                  <dt>Longest run</dt>
                  <dd>{span(target.max_duration_s)}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          <SignIn key={target.id} slug={slug} target={target} encryptionReady={setup.encryption_ready} />
        </div>
      ) : (
        <p className={`${styles.note} ${styles.rule}`} data-performance-block="sign-in">
          {setup.targets.length
            ? 'Choose a target to see its address and its sign-in.'
            : manage
              ? 'This project has no target yet. Add one: the name of an environment and its address.'
              : 'This project has no target yet. A project manager adds targets.'}
        </p>
      )}
    </div>
  );
}

const READING = 'Reading the targets';

/** A line with a Skeleton bone, as tall as the line it stands for (a text line, or a tag: `--badge-height`). */
function Bone({ width, tag, className }: { width: string; tag?: boolean; className?: string }) {
  return (
    <span className={`${styles.bone} ${className ?? ''}`} data-tag={tag ? '' : undefined}>
      <Skeleton kind="value" width={width} height={tag ? 'var(--badge-height)' : undefined} label={READING} />
    </span>
  );
}

/**
 * Bones that wrap like the words they stand for: one Skeleton per word, `ch` wide, a space between them, so a
 * narrow column breaks the frame where it breaks the text. `'person'` is a person's name (a disc and a name).
 */
function Words({ words }: { words: (number | 'person')[] }) {
  return (
    <>
      {words.map((word, index) => (
        <span key={index}>
          {index ? ' ' : null}
          <Skeleton
            kind="value"
            width={word === 'person' ? '9ch' : `${word}ch`}
            height={word === 'person' ? 'var(--badge-height)' : undefined}
            label={READING}
          />
        </span>
      ))}
    </>
  );
}

/**
 * Step 1 before the settings are read: the same option grid (two targets, as most projects have a pre-production
 * and a production one, then "Add a target") and the same sign-in block, with Skeleton bones for the words.
 */
export function TargetStepFrame() {
  return (
    <div className={styles.stack}>
      <div className={styles.options}>
        {[0, 1].map((index) => (
          <div key={index} className={styles.option} data-frame="">
            <Bone className={styles.optionTitle} width="8em" tag />
            <Bone className={styles.host} width="12em" />
            <Bone width="8em" tag />
          </div>
        ))}
        <div className={styles.option} data-add="" data-frame="">
          <span className={styles.optionTitle}>
            <Icon name="plus" size={12} />
            Add a target
          </span>
          <span>{ADD_ABOUT}</span>
        </div>
      </div>
      <div className={`${styles.stack} ${styles.rule}`} data-performance-block="sign-in">
        <div className={`${styles.row} ${styles.between}`}>
          <span className={styles.row}>
            <span className={styles.label}>Questions go to</span>
            {/* An address: no spaces, so it breaks anywhere; bones of 8 characters stand for it. */}
            <span className={styles.host}>
              <Words words={[8, 8, 8, 8, 8, 7]} />
            </span>
          </span>
          <Skeleton kind="value" width="7em" height="var(--control-height)" label={READING} />
        </div>
        <div className={`${styles.row} ${styles.between}`}>
          <span className={styles.row}>
            <Skeleton kind="value" width="7em" height="var(--badge-height)" label={READING} />
            {/* "Refresh token ends in 1234, saved Nov 22, 18:08 by <person>" */}
            <span>
              <Words words={[7, 5, 4, 2, 5, 5, 3, 3, 5, 2, 'person']} />
            </span>
          </span>
          <Skeleton kind="value" width="9em" height="var(--control-height)" label={READING} />
        </div>
        <p className={styles.note}>{TOKENS_NOTE}</p>
      </div>
    </div>
  );
}
