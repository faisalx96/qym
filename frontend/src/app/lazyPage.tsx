import { lazy, Suspense, type ComponentType } from 'react';
import { Skeleton } from '@/ui';

/**
 * A route element whose module is fetched on first visit, so heavy pages (the launch form with
 * react-hook-form and zod, the environments editors) stay out of the entry chunk. A failed
 * chunk fetch throws into the route's errorElement.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): ComponentType {
  const Page = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return function LazyPage() {
    return (
      <Suspense fallback={<Skeleton kind="lines" rows={6} label="Loading page" />}>
        <Page />
      </Suspense>
    );
  };
}
