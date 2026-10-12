import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { appBase, isDev } from '@/lib/runtime';
import { ROUTES } from './routes';
import { AppShell } from '@/features/shell/AppShell';
import { RequireAuth } from '@/features/shell/RequireAuth';
import { ProjectLayout } from '@/features/shell/ProjectLayout';
import { LoginPage } from '@/features/shell/login/LoginPage';
import { ProjectsPage } from '@/features/shell/projects/ProjectsPage';
import { ProfilePage } from '@/features/shell/profile/ProfilePage';
import { ProjectSettingsPage } from '@/features/shell/settings/ProjectSettingsPage';
import { LegacyRunRedirect } from '@/features/shell/LegacyRunRedirect';
import { NotFound } from '@/features/shell/NotFound';
import { RouteError } from '@/features/shell/RouteError';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { DocsRedirect } from '@/features/docs/DocsRedirect';
import { RunsPage } from '@/features/runs-list';
import { RunAnalyzerRedirect } from '@/features/analyzer/RunAnalyzerRedirect';
import { lazyPage } from './lazyPage';

// Heavy pages are fetched on first visit so the entry chunk stays small (see frontend/README.md).
const OverviewPage = lazyPage(() => import('@/features/runs-list/OverviewPage'), 'OverviewPage');
const ChartsPage = lazyPage(() => import('@/features/runs-list/ChartsPage'), 'ChartsPage');
const RunDetailPage = lazyPage(() => import('@/features/run-detail/RunDetailPage'), 'RunDetailPage');
const ComparePage = lazyPage(() => import('@/features/compare/ComparePage'), 'ComparePage');
const AnalyzerPage = lazyPage(() => import('@/features/analyzer/AnalyzerPage'), 'AnalyzerPage');
const DatasetsRoutes = lazyPage(() => import('@/features/datasets/DatasetsRoutes'), 'DatasetsRoutes');
const ReviewsPage = lazyPage(() => import('@/features/reviews/ReviewsPage'), 'ReviewsPage');
const TrashPage = lazyPage(() => import('@/features/trash/TrashPage'), 'TrashPage');
const AdminPage = lazyPage(() => import('@/features/admin/AdminPage'), 'AdminPage');
const DocsPage = lazyPage(() => import('@/features/docs/DocsPage'), 'DocsPage');
// The experiments area is the heaviest (launch form, editors).
const ExperimentsIndexRoute = lazyPage(
  () => import('@/features/experiments/ExperimentsRoutes'),
  'ExperimentsIndexRoute',
);
const ExperimentsSplatRoute = lazyPage(
  () => import('@/features/experiments/ExperimentsRoutes'),
  'ExperimentsSplatRoute',
);
const QueuePage = lazyPage(() => import('@/features/experiments/queue/QueuePage'), 'QueuePage');
const EnvironmentsRoute = lazyPage(
  () => import('@/features/environments/EnvironmentsRoutes'),
  'EnvironmentsRoute',
);
const ModelsPage = lazyPage(() => import('@/features/models/ModelsPage'), 'ModelsPage');

const C = ROUTES.projectChildren;

/** Project-scoped routes (brief 01 §8). */
const projectChildren: RouteObject[] = [
  { index: true, element: <RunsPage /> },
  { path: C.overview, element: <OverviewPage /> },
  { path: C.charts, element: <ChartsPage /> },
  { path: C.models, element: <ModelsPage /> },
  { path: C.experimentsQueue, element: <QueuePage /> },
  { path: C.experiments, element: <ExperimentsIndexRoute /> },
  { path: C.experimentsSplat, element: <ExperimentsSplatRoute /> },
  { path: C.environments, element: <EnvironmentsRoute /> },
  { path: C.datasets, element: <DatasetsRoutes /> },
  { path: C.datasetsSplat, element: <DatasetsRoutes /> },
  { path: C.analysis, element: <AnalyzerPage /> },
  { path: C.reviews, element: <ReviewsPage /> },
  { path: C.compare, element: <ComparePage /> },
  { path: C.settings, element: <ProjectSettingsPage /> },
  {
    path: C.runs_detail,
    element: (
      <RunAnalyzerRedirect>
        <RunDetailPage />
      </RunAnalyzerRedirect>
    ),
  },
];

const devRoutes: RouteObject[] = isDev
  ? [
      {
        path: ROUTES.devUi,
        lazy: () => import('@/features/dev/UiGallery').then((m) => ({ Component: m.UiGallery })),
      },
      {
        path: ROUTES.devMock,
        lazy: () => import('@/features/dev/MockHost').then((m) => ({ Component: m.MockHost })),
      },
    ]
  : [];

export const routes: RouteObject[] = [
  { path: ROUTES.login, element: <LoginPage />, errorElement: <RouteError /> },
  ...devRoutes,
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: ROUTES.projects, element: <ProjectsPage /> },
          { path: ROUTES.profile, element: <ProfilePage /> },
          {
            element: <AdminGuard />,
            children: [
              { path: ROUTES.admin, element: <Navigate to="/admin/runs" replace /> },
              { path: ROUTES.adminTab, element: <AdminPage /> },
            ],
          },
          {
            path: ROUTES.trash,
            element: <TrashPage />,
          },
          { path: ROUTES.compare, element: <ComparePage /> },
          { path: ROUTES.reviews, element: <ReviewsPage /> },
          { path: ROUTES.docs, element: <DocsRedirect /> },
          { path: ROUTES.docsIndex, element: <DocsRedirect /> },
          { path: ROUTES.docsPage, element: <DocsPage /> },
          { path: ROUTES.docsNew, element: <DocsRedirect /> },
          { path: ROUTES.legacyRun, element: <LegacyRunRedirect /> },
          { path: ROUTES.project, element: <ProjectLayout />, children: projectChildren },
          { path: '/index.html', element: <Navigate to="/" replace /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes, { basename: appBase() });
}

export { Outlet };
