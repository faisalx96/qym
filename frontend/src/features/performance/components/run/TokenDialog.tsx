/**
 * Performance run page: hands a new token to a run that waits for one.
 * The token lives only in the dialog's own field while it is open: the form drops its values when it closes,
 * the write hook keeps the input without the token, and nothing here stores or shows what was typed.
 */
import {
  performanceError,
  useHandOffPerformanceToken,
  type PerformanceRunRead,
  type PerformanceTokenName,
  type TokenHandoffError,
} from '@/api/performance';
import { FormDialog } from '@/ui';
import styles from './run.module.css';

const TOKEN_WORDS: Record<PerformanceTokenName, string> = {
  refresh_token: 'refresh token',
  access_token: 'access token',
};

export function TokenDialog({
  slug,
  runId,
  read,
  open,
  onOpenChange,
}: {
  slug: string;
  runId: string;
  read: PerformanceRunRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const handOff = useHandOffPerformanceToken(slug, runId);
  const name = read.token_needed ?? 'refresh_token';
  const words = TOKEN_WORDS[name];
  const target = read.config.target;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Send a new ${words}`}
      description={`Run ${read.run.number} waits for it. The token is saved for ${target.name}; the users pick it up within 30s and the run goes on.`}
      fields={[
        {
          name: 'token',
          label: `New ${words}`,
          type: 'password',
          mono: true,
          required: true,
          autoFocus: true,
          help:
            name === 'refresh_token' ? (
              <>
                Copy it from the browser where you are signed in to Insightor: developer tools, Application,
                Cookies, the value of <span className={styles.literal}>{target.refresh_cookie_name}</span>.
                Only its last four characters are shown after saving.
              </>
            ) : (
              'Copy it from the browser where you are signed in to Insightor. Only its last four characters are shown after saving.'
            ),
        },
      ]}
      confirmLabel="Send token"
      submittingLabel="Sending…"
      onSubmit={async (values) => {
        try {
          await handOff.mutateAsync({ name, token: String(values.token ?? '').trim() });
        } catch (error) {
          return (
            performanceError<TokenHandoffError>(error)?.message ??
            'The request did not reach qym. The token was not saved. Try again.'
          );
        }
      }}
    />
  );
}
