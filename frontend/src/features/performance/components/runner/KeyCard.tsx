/** Runner page: the API key that receives the sign-in tokens. Only a manager chooses it. */
import { useState } from 'react';
import { performanceError, type PerformanceRunnerRead, type SetRunnerKeyError } from '@/api/performance';
import { useSetPerformanceRunnerKey } from '@/api/performanceRunner';
import { SettingsCard } from '@/features/shell/settings/SettingsCard';
import { formatTableDate } from '@/lib/dates';
import { errorSentence } from '@/lib/http';
import { InlineNotice, Select, StateTag, UserName } from '@/ui';
import { tagShape } from '../home/placeholders';
import styles from './runner.module.css';

const TITLE = 'Runner key';
const DESCRIPTION =
  'The API key the runner signs in with. Only this key receives the sign-in tokens of the targets. Only a manager can change it.';
/** Why a person who is not a manager sees the choice locked (it stays in place, disabled, §3.1). */
export const KEY_MANAGER_ONLY = 'Only a project manager can choose the runner key';

/** The key card while the page loads: the same card, field and save row with skeleton values (§7). */
export function KeyFrame() {
  return (
    <SettingsCard
      title={TITLE}
      description={DESCRIPTION}
      data-performance-block="runner-key"
      save={{
        dirty: false,
        onSave: () => undefined,
        isDisabled: true,
        disabledReason: 'The page is loading',
      }}
    >
      <div className={styles.stack}>
        <div className={styles.row}>
          <Select
            label="API key"
            width={320}
            items={[]}
            value={null}
            onChange={() => undefined}
            isDisabled
            placeholder=""
          />
          {tagShape('Loading whether the runner uses this key')}
        </div>
        {tagShape('Loading when the key was chosen')}
      </div>
    </SettingsCard>
  );
}

export function KeyCard({ slug, read }: { slug: string; read: PerformanceRunnerRead }) {
  const save = useSetPerformanceRunnerKey(slug);
  const saved = read.runner_key;
  // The choice not saved yet; null while the list shows the saved key.
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const value = draft ?? saved?.id ?? null;
  const changed = draft !== null && draft !== (saved?.id ?? null);
  const matches = read.runner?.runner_key_matches ?? null;
  // A key that was chosen and is no longer in the project's list still shows by its name. A person who is not a
  // manager gets no list of keys from the API: the chosen one is the only entry of the locked field.
  const listed = read.can_manage ? read.api_keys : [];
  const keys = saved && !listed.some((key) => key.id === saved.id) ? [...listed, saved] : listed;

  async function submit() {
    if (!changed) return;
    setRefusal(null);
    try {
      await save.mutateAsync(draft);
      setDraft(null);
    } catch (error) {
      setRefusal(performanceError<SetRunnerKeyError>(error)?.message ?? errorSentence(error));
    }
  }

  return (
    <SettingsCard
      title={TITLE}
      description={DESCRIPTION}
      data-performance-block="runner-key"
      // One save row (§3.2): state text at the start only while something changed, Save at the end.
      save={{
        dirty: changed,
        saving: save.isPending,
        onSave: () => void submit(),
        isDisabled: !read.can_manage,
        disabledReason: read.can_manage ? undefined : KEY_MANAGER_ONLY,
      }}
    >
      <div className={styles.stack}>
        <div className={styles.row}>
          <Select
            label="API key"
            width={320}
            items={keys.map((key) => ({ key: key.id, label: `${key.name} · ${key.prefix}` }))}
            value={value}
            placeholder="None chosen"
            onChange={(key) => {
              setRefusal(null);
              setDraft(key === null ? null : String(key));
            }}
            isDisabled={!read.can_manage || save.isPending}
          />
          {matches !== null && !changed ? (
            <StateTag tone={matches ? 'success' : 'warning'}>
              {matches ? 'The runner uses this key' : 'The runner uses another key'}
            </StateTag>
          ) : null}
        </div>
        {/* When and by whom the key was chosen: a fact of the card body, not a save state (C145). */}
        {saved?.changed_at ? (
          <span className={`${styles.row} ${styles.muted} ${styles.figures}`} data-performance-key="chosen">
            Chosen {formatTableDate(saved.changed_at)}
            {saved.changed_by ? (
              <>
                {' by '}
                <UserName id={saved.changed_by_user_id} name={saved.changed_by} />
              </>
            ) : null}
          </span>
        ) : null}
        {!saved ? (
          <InlineNotice tone="warning" lead="No key is chosen.">
            Until a manager chooses one, no runner receives the sign-in tokens and no run can start.
          </InlineNotice>
        ) : null}
        {refusal ? (
          <InlineNotice tone="danger" lead="Not saved." data-testid="performance-runner-key-refusal">
            {refusal}
          </InlineNotice>
        ) : null}
      </div>
    </SettingsCard>
  );
}
