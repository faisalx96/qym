import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthProviders } from '@/api/me';
import type { AuthProvider } from '@/api/types';
import { api, ApiError, sameOriginTarget } from '@/lib/http';
import { appUrl, bootstrap, platformUrl } from '@/lib/runtime';
import { useDelayedPending } from '@/lib/pending';
import { Button, EmptyState, ErrorState, Icon, Skeleton, Stack, Text, TextField, Card } from '@/ui';
import { useDocumentTitle } from '../hooks';
import brandIcon from '@/assets/brand/qym-icon.png';
import brandText from '@/assets/brand/qym-text.png';
import { ProviderIcon, providerDescription } from './ProviderIcon';
import styles from './LoginPage.module.css';

type Mode = 'signin' | 'signup' | 'change-password';

interface Status {
  tone: 'error' | 'info' | 'success';
  text: string;
}

/**
 * /login — shell-less. Reads GET /v1/auth/providers; password sign-in,
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
      <Card as="section" className={styles.panel} aria-labelledby="login-title">
        <div className={styles.panelBody}>
          <header className={styles.header}>
            <img src={brandIcon} alt="" className={styles.logo} width={64} height={64} />
            <img src={brandText} alt="qym" className={styles.wordmark} width={57} height={36} />
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
            <ErrorState
              error={providers.error}
              title="Couldn’t load sign-in options"
              onRetry={() => providers.refetch()}
              compact
            />
          ) : (
            <LoginBody
              providers={providers.data.providers}
              localAuth={providers.data.local_auth}
              next={next}
            />
          )}
        </div>
      </Card>
    </main>
  );
}

function LoginBody({
  providers,
  localAuth,
  next,
}: {
  providers: AuthProvider[];
  localAuth: { enabled: boolean; signup_enabled: boolean };
  next: string;
}) {
  const enabled = providers.filter((p) => p.enabled);
  const [mode, setMode] = useState<Mode>('signin');
  // Held in memory only: never written to storage.
  const [pending, setPending] = useState<{ email: string; temporary: string }>({ email: '', temporary: '' });
  if (!localAuth.enabled && enabled.length === 0) {
    const { authMode } = bootstrap();
    return (
      <EmptyState
        compact
        icon={<Icon name="shield" />}
        title="No login methods are configured"
        body={
          authMode === 'none'
            ? 'This deployment signs everyone in automatically; open the app directly.'
            : 'Ask the platform administrator to enable password sign-in or an identity provider.'
        }
        action={
          authMode === 'none' ? (
            <Button variant="primary" onPress={() => window.location.assign(next)}>
              Open qym
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <Stack gap="lg">
      {localAuth.enabled ? (
        <>
          {mode === 'change-password' ? null : mode === 'signup' ? (
            <SignupForm next={next} onBack={() => setMode('signin')} />
          ) : (
            <PasswordForm
              next={next}
              initialEmail={pending.email}
              onNeedsChange={(email, temporary) => {
                setPending({ email, temporary });
                setMode('change-password');
              }}
            />
          )}
          {mode === 'change-password' ? (
            <ChangePasswordForm
              next={next}
              email={pending.email}
              temporary={pending.temporary}
              onBack={() => {
                setPending({ email: pending.email, temporary: '' });
                setMode('signin');
              }}
            />
          ) : null}
          {mode === 'signin' && localAuth.signup_enabled ? (
            <Text variant="sm" as="p" className={styles.switch}>
              New to qym?{' '}
              <button
                type="button"
                className={styles.link}
                onClick={() => setMode('signup')}
                data-signup-toggle
              >
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
            <a
              key={p.id}
              className={styles.provider}
              href={`${platformUrl(`/v1/auth/login/${encodeURIComponent(p.id)}`)}?next=${encodeURIComponent(next)}`}
              data-provider={p.id}
            >
              <span className={styles.providerIcon} data-provider-icon={p.id}>
                <ProviderIcon id={p.id} />
              </span>
              <span className={styles.providerText}>
                <span className={styles.providerLabel}>{p.label || `Continue with ${p.id}`}</span>
                <span className={styles.providerDesc}>{providerDescription(p.id)}</span>
              </span>
              <Icon name="chevron-right" size={14} />
            </a>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function StatusLine({ status }: { status: Status | null }) {
  return (
    <p
      className={styles.status}
      role={status?.tone === 'error' ? 'alert' : 'status'}
      data-tone={status?.tone}
      aria-live="polite"
    >
      {status?.text ?? ''}
    </p>
  );
}

function PasswordForm({
  next,
  initialEmail,
  onNeedsChange,
}: {
  next: string;
  initialEmail: string;
  onNeedsChange: (email: string, temporary: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [clearKey, setClearKey] = useState(0);

  function clearError() {
    setStatus((s) => (s?.tone === 'error' ? null : s));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.post<{ ok: boolean; next?: string }>(
        `/v1/auth/login/password?next=${encodeURIComponent(next)}`,
        { email: email.trim(), password },
        { silent401: true },
      );
      window.location.assign(sameOriginTarget(res.next, next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.code === 'password_change_required') {
        onNeedsChange(email.trim(), password);
        return;
      }
      const text =
        err instanceof ApiError
          ? err.detail ||
            (err.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid email or password')
          : 'The server could not be reached.';
      setStatus({ tone: 'error', text });
      setPassword('');
      setClearKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} data-password-form>
      <TextField
        label="Email"
        type="email"
        name="email"
        size="auth"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError();
        }}
        autoComplete="username"
        placeholder="name@company.com"
        isRequired
        autoFocus
      />
      <TextField
        key={clearKey}
        label="Password"
        type="password"
        name="password"
        size="auth"
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError();
        }}
        autoComplete="current-password"
        placeholder="Enter your password"
        help="Forgot your password? Ask an admin to reset it."
        isRequired
        autoFocus={clearKey > 0}
      />
      <StatusLine status={status} />
      <Button type="submit" variant="primary" size="md" loading={busy} className={styles.submit}>
        Sign in
      </Button>
    </form>
  );
}

function ChangePasswordForm({
  next,
  email,
  temporary,
  onBack,
}: {
  next: string;
  email: string;
  temporary: string;
  onBack: () => void;
}) {
  const confirmRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>({
    tone: 'info',
    text: 'Your password was reset. Choose a new one to continue.',
  });

  function clearError() {
    setStatus((s) => (s?.tone === 'error' ? null : s));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setStatus({ tone: 'error', text: 'The passwords do not match.' });
      confirmRef.current?.focus();
      return;
    }
    if (password.length < 8) return setStatus({ tone: 'error', text: 'Use at least 8 characters.' });
    if (password === temporary)
      return setStatus({ tone: 'error', text: 'Choose a password different from the temporary one.' });
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; next?: string }>(
        `/v1/auth/password/change?next=${encodeURIComponent(next)}`,
        { email, current_password: temporary, new_password: password },
        { silent401: true },
      );
      window.location.assign(sameOriginTarget(res.next, next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStatus({ tone: 'error', text: 'The temporary password is no longer valid. Sign in again.' });
        setTimeout(onBack, 1200);
        return;
      }
      setStatus({
        tone: 'error',
        text:
          err instanceof ApiError
            ? err.detail || 'Could not change the password.'
            : 'The server could not be reached.',
      });
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
      <TextField
        label="New password"
        type="password"
        size="auth"
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError();
        }}
        autoComplete="new-password"
        placeholder="At least 8 characters"
        isRequired
        autoFocus
      />
      <TextField
        ref={confirmRef}
        label="Confirm new password"
        type="password"
        size="auth"
        value={confirm}
        onChange={(v) => {
          setConfirm(v);
          clearError();
        }}
        autoComplete="new-password"
        placeholder="Enter the new password again"
        isRequired
      />
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
      const res = await api.post<{ ok: boolean; next?: string }>(
        `/v1/auth/signup/password?next=${encodeURIComponent(next)}`,
        { email: email.trim(), password, display_name: displayName.trim() },
        { silent401: true },
      );
      window.location.assign(sameOriginTarget(res.next, next));
    } catch (err) {
      setStatus({
        tone: 'error',
        text:
          err instanceof ApiError
            ? err.detail || 'Could not create the account.'
            : 'The server could not be reached.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} data-signup-form>
      <Text variant="md" as="h2">
        Create an account
      </Text>
      <TextField
        label="Display name"
        size="auth"
        value={displayName}
        onChange={setDisplayName}
        autoComplete="name"
        placeholder="Team member"
        autoFocus
      />
      <TextField
        label="Email"
        type="email"
        size="auth"
        value={email}
        onChange={setEmail}
        autoComplete="username"
        placeholder="name@company.com"
        isRequired
      />
      <TextField
        label="Password"
        type="password"
        size="auth"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        placeholder="At least 8 characters"
        isRequired
        help="At least 8 characters."
      />
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
