import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useMe } from '@/api/me';
import { ApiError, redirectToLogin } from '@/lib/http';
import { bootstrap } from '@/lib/runtime';
import { useDelayedPending } from '@/lib/pending';
import { ErrorState, EmptyState, Button, Skeleton } from '@/ui';
import { AuthContext } from './AuthContext';
import styles from './RequireAuth.module.css';

/**
 * Gate: renders nothing until ['me'] resolves. 401 → full navigation to
 * /login?next=… when a login exists; otherwise (proxy_headers / none) a
 * static "identity missing" panel so the app never loops (brief 01 §8.4).
 */
export function RequireAuth() {
  const me = useMe();
  const showSkeleton = useDelayedPending(me.isPending);
  const unauthorized = me.error instanceof ApiError && me.error.status === 401;
  const { sessionAuth, authMode } = bootstrap();

  useEffect(() => {
    if (unauthorized && sessionAuth) redirectToLogin();
  }, [unauthorized, sessionAuth]);

  if (me.isPending) {
    return showSkeleton ? (
      <div className={styles.frame} aria-busy="true" data-auth-pending>
        <Skeleton kind="lines" rows={4} label="Signing in" />
      </div>
    ) : null;
  }
  if (unauthorized) {
    if (sessionAuth) return null; // redirecting
    return (
      <div className={styles.frame} data-auth-missing>
        <EmptyState
          title="No user identity"
          body={
            authMode === 'proxy_headers'
              ? 'The identity headers (X-User-Email) did not reach the platform. Check the proxy in front of qym.'
              : 'The platform rejected this session and no sign-in method is configured.'
          }
          action={
            <Button variant="accent" onPress={() => me.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }
  // A failed background refetch keeps the cached user: never tear the app down for it.
  if (!me.data) {
    return (
      <div className={styles.frame}>
        <ErrorState error={me.error} title="Couldn’t load your account" onRetry={() => me.refetch()} />
      </div>
    );
  }
  return (
    <AuthContext.Provider
      value={{ me: me.data, isAdmin: me.data.role === 'ADMIN', refetch: () => void me.refetch() }}
    >
      <Outlet />
    </AuthContext.Provider>
  );
}
