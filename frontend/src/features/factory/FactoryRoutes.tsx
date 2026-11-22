/** /projects/:slug/factory[/*] dispatcher: the connected datasets list, or one factory's page. */
import { lazy, Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FactoryListPage } from './FactoryListPage';
import { parseFactoryRoute } from './lib/route';

const FactoryDetailPage = lazy(() =>
  import('./FactoryDetailPage').then((m) => ({ default: m.FactoryDetailPage })),
);

export function FactoryRoutes() {
  const params = useParams();
  const [search] = useSearchParams();
  const route = parseFactoryRoute(params['*'], search);
  if (route.mode === 'detail' && route.factoryId)
    return (
      <Suspense fallback={null}>
        <FactoryDetailPage factoryId={route.factoryId} />
      </Suspense>
    );
  return <FactoryListPage />;
}

export default FactoryRoutes;
