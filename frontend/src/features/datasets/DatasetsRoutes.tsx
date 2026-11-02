/** /projects/:slug/datasets[/*] dispatcher: catalog, deleted view, detail, item page, compare. */
import { lazy, Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { parseDatasetRoute } from './lib/route';
import { CatalogPage } from './catalog/CatalogPage';
import { DeletedDatasetsPage } from './catalog/DeletedDatasetsPage';

const DatasetDetailPage = lazy(() =>
  import('./detail/DatasetDetailPage').then((m) => ({ default: m.DatasetDetailPage })),
);
const DatasetComparePage = lazy(() =>
  import('./compare/DatasetComparePage').then((m) => ({ default: m.DatasetComparePage })),
);

export function DatasetsRoutes() {
  const params = useParams();
  const [search] = useSearchParams();
  const route = parseDatasetRoute(params['*'], search);
  switch (route.mode) {
    case 'deleted':
      return <DeletedDatasetsPage />;
    case 'compare':
      return (
        <Suspense fallback={null}>
          <DatasetComparePage datasetRef={route.ref} />
        </Suspense>
      );
    case 'detail':
    case 'item':
      return (
        <Suspense fallback={null}>
          <DatasetDetailPage datasetRef={route.ref} />
        </Suspense>
      );
    default:
      return <CatalogPage />;
  }
}
