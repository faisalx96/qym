import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ErrorState } from '@/ui';
import { constrained } from './layout';

/** Router-level error boundary (render errors, loader errors). */
export function RouteError() {
  const error = useRouteError();
  const normalized = isRouteErrorResponse(error) ? { status: error.status, detail: error.statusText } : error;
  return (
    <div className={constrained} role="presentation">
      <ErrorState error={normalized} title="Something went wrong" onRetry={() => window.location.reload()} />
    </div>
  );
}
