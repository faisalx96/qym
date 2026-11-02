import { useState } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ErrorState } from '@/ui';
import { recoverFromChunkError } from '@/lib/chunk-recovery';
import { constrained } from './layout';

/** Router-level error boundary (render errors, loader errors). */
export function RouteError() {
  const error = useRouteError();
  // A lazy route whose chunk is gone (stale bundle after a deploy) reloads the page once instead of an error.
  const [reloading] = useState(() => recoverFromChunkError(error));
  if (reloading) {
    return (
      <div className={constrained} role="status" aria-live="polite">
        Reloading the app…
      </div>
    );
  }
  const normalized = isRouteErrorResponse(error) ? { status: error.status, detail: error.statusText } : error;
  return (
    <div className={constrained} role="presentation">
      <ErrorState error={normalized} title="Something went wrong" onRetry={() => window.location.reload()} />
    </div>
  );
}
