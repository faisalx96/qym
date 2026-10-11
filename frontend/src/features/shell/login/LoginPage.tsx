import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthProviders } from '@/api/me';
import type { AuthProvider } from '@/api/types';
import { api, ApiError, sameOriginTarget } from '@/lib/http';
import { appUrl, bootstrap, platformUrl } from '@/lib/runtime';
import { useDelayedPending } from '@/lib/pending';
import { Button, EmptyState, ErrorState, Icon, Skeleton, Stack, Text, TextField } from '@/ui';
import { useDocumentTitle } from '../hooks';
import styles from './LoginPage.module.css';

type Mode = 'signin' | 'signup' | 'change-password';

interface Status {
  tone: 'error' | 'info' | 'success';
  text: string;
}

/**
 * /app/login — shell-less. Reads GET /v1/auth/providers; password sign-in,
 * temporary-password change, sign-up (only while allowed) and provider links.
 * Clears sessionStorage on load so the previous user's per-tab state is gone.
 */
export function LoginPage() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const next = sameOriginTarget(params.get('next'), appUrl('/'));
  const providers = useAuthProviders();
  const showSkeleton = useDelayedPending(providers.isPending);
  useEffect(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <main className={styles.page} data-login-page>
      <div className={styles.backdrop} aria-hidden="true" />
      <section className={styles.card} aria-labelledby="login-title">
        <header className={styles.header}>
          <span className={styles.logo} aria-hidden="true">
            قيِّم
          </span>
          <Text variant="xl" as="h1" id="login-title">
            Sign in to qym
          </Text>
          <Text variant="sm">Evaluation runs, datasets and reviews for your projects.</Text>
        </header>
        {providers.isPending ? (
          showSkeleton ? (
            <Skeleton kind="lines" rows={4} label="Loading sign-in options" />
          ) : null
        ) : providers.isError ? (
          <ErrorState error={providers.error} title="Couldn’t load sign-in options" onRetry={() => providers.refetch()} compact />
        ) : (
          <LoginBody providers={providers.data.providers} localAuth={providers.data.local_auth} next={next} />
        )}
      </section>
    </main>
  );
}

function LoginBody({ providers, localAuth, next }: { providers: AuthProvider[]; localAuth: { enabled: boolean; signup_enabled: boolean }; next: string }) {
  const enabled = providers.filter((p) => p.enabled);
  const [mode, setMode] = useState<Mode>('signin');
  if (!localAuth.enabled && enabled.length === 0) {
    const { authMode } = bootstrap();
    return (
      <EmptyState
        compact
        icon={<Icon name="shield" />}
        title="No login methods are configured"
        body={authMode === 'none' ? 'This deployment signs everyone in automatically; open the app directly.' : 'Ask the platform administrator to enable password sign-in or an identity provider.'}
        action={authMode === 'none' ? <Button variant="primary" onPress={() => window.location.assign(next)}>Open qym</Button> : undefined}
      />
    );
  }
  return (
    <Stack gap="lg">
      {localAuth.enabled ? (
        <>
          {mode === 'change-password' ? null : mode === 'signup' ? <SignupForm next={next} onBack={() => setMode('signin')} /> : <PasswordForm next={next} onNeedsChange={() => setMode('change-password')} />}
          {mode === 'change-password' ? <ChangePasswordForm next={next} onBack={() => setMode('signin')} /> : null}
          {mode === 'signin' && localAuth.signup_enabled ? (
            <Text variant="sm" as="p" className={styles.switch}>
              New to qym?{' '}
              <button type="button" className={styles.link} onClick={() => setMode('signup')} data-signup-toggle>
                Create an account
              </button>
            </Text>
          ) : null}
        </>
      ) : null}
      {localAuth.enabled && enabled.length ? (
        <div className={styles.divider} role="separator">
          <span>Or continue with</span>
        </div>
      ) : null}
      {enabled.length ? (
        <Stack gap="sm" data-providers>
          {enabled.map((p) => (
            <a key={p.id} className={styles.provider} href={`${platformUrl(`/v1/auth/login/${encodeURIComponent(p.id)}`)}?next=${encodeURIComponent(next)}`} data-provider={p.id}>
              <Icon name="external" size={14} />
              <span>Continue with {p.label}</span>
            </a>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function StatusLine({ status }: { status: Status | null }) {
  return (
    <p className={styles.status} role={status?.tone === 'error' ? 'alert' : 'status'} data-tone={status?.tone} aria-live="polite">
      {status?.text ?? ''}
    </p>
  );
}

function PasswordForm({ next, onNeedsChange }: { next: string; onNeedsChange: () => void }) {
  const [email, setEmail] = useState(() => sessionStorage.getItem('qym:login-email') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [clearKey, setClearKey] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.post<{ ok: boolean; next?: string }>(`/v1/auth/login/password?next=${encodeURIComponent(next)}`, { email: email.trim(), password }, { silent401: true });
      window.location.assign(sameOriginTarget(res.next, next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.code === 'password_change_required') {
        sessionStorage.setItem('qym:login-email', email.trim());
        sessionStorage.setItem('qym:login-temp', password);
        onNeedsChange();
        return;
      }
      const text = err instanceof ApiError ? err.detail || (err.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid email or password') : 'The server could not be reached.';
      setStatus({ tone: 'error', text });
      setPassword('');
      setClearKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} data-password-form>
      <TextField label="Email" type="email" name="email" size="auth" value={email} onChange={setEmail} autoComplete="username" isRequired autoFocus />
      <TextField key={clearKey} label="Password" type="password" name="password" size="auth" value={password} onChange={setPassword} autoComplete="current-password" isRequired autoFocus={clearKey > 0} />
      <StatusLine status={status} />
      <Button type="submit" variant="primary" size="md" loading={busy} className={styles.submit}>
        Sign in
      </Button>
    </form>
  );
}

function ChangePasswordForm({ next, onBack }: { next: string; onBack: () => void }) {
  const email = sessionStorage.getItem('qym:login-email') ?? '';
  const temporary = sessionStorage.getItem('qym:login-temp') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>({ tone: 'info', text: 'Your password was reset. Choose a new one to continue.' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setStatus({ tone: 'error', text: 'The passwords do not match.' });
    if (password.length < 8) return setStatus({ tone: 'error', text: 'Use at least 8 characters.' });
    if (password === temporary) return setStatus({ tone: 'error', text: 'Choose a password different from the temporary one.' });
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; next?: string }>(`/v1/auth/password/change?next=${encodeURIComponent(next)}`, { email, current_password: temporary, new_password: password }, { silent401: true });
      sessionStorage.removeItem('qym:login-temp');
      window.location.assign(sameOriginTarget(res.next, next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        sessionStorage.removeItem('qym:login-temp');
        setStatus({ tone: 'error', text: 'The temporary password is no longer valid. Sign in again.' });
        setTimeout(onBack, 1200);
        return;
      }
      setStatus({ tone: 'error', text: err instanceof ApiError ? err.detail || 'Could not change the password.' : 'The server could not be reached.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} data-change-password-form>
      <Text variant="md" as="h2">
        Choose a new password
      </Text>
      <TextField label="Email" type="email" size="auth" value={email} isReadOnly autoComplete="username" />
      <TextField label="New password" type="password" size="auth" value={password} onChange={setPassword} autoComplete="new-password" isRequired autoFocus />
      <TextField label="Confirm new password" type="password" size="auth" value={confirm} onChange={setConfirm} autoComplete="new-password" isRequired />
      <StatusLine status={status} />
      <Button type="submit" variant="primary" size="md" loading={busy} className={styles.submit}>
        Change password and sign in
      </Button>
      <button type="button" className={styles.link} onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}

function SignupForm({ next, onBack }: { next: string; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setStatus({ tone: 'error', text: 'Use at least 8 characters.' });
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.post<{ ok: boolean; next?: string }>(`/v1/auth/signup/password?next=${encodeURIComponent(next)}`, { email: email.trim(), password, display_name: displayName.trim() }, { silent401: true });
      window.location.assign(sameOriginTarget(res.next, next));
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof ApiError ? err.detail || 'Could not create the account.' : 'The server could not be reached.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} data-signup-form>
      <Text variant="md" as="h2">
        Create an account
      </Text>
      <TextField label="Display name" size="auth" value={displayName} onChange={setDisplayName} autoComplete="name" autoFocus />
      <TextField label="Email" type="email" size="auth" value={email} onChange={setEmail} autoComplete="username" isRequired />
      <TextField label="Password" type="password" size="auth" value={password} onChange={setPassword} autoComplete="new-password" isRequired help="At least 8 characters." />
      <StatusLine status={status} />
      <Button type="submit" variant="primary" size="md" loading={busy} className={styles.submit}>
        Create account
      </Button>
      <button type="button" className={styles.link} onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}
