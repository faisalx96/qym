import { lazy, Suspense } from 'react';
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
import { ComingSoon } from '@/features/dev/ComingSoon';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { AdminPage } from '@/features/admin/AdminPage';
import { DocsPage } from '@/features/docs/DocsPage';
import { DocsRedirect } from '@/features/docs/DocsRedirect';

import { RunsPage, OverviewPage, ChartsPage } from '@/features/runs-list';

const ReviewsPageLazy = lazy(() => import('@/features/reviews/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const TrashPageLazy = lazy(() => import('@/features/trash/TrashPage').then((m) => ({ default: m.TrashPage })));
const DatasetsRoutesLazy = lazy(() => import('@/features/datasets/DatasetsRoutes').then((m) => ({ default: m.DatasetsRoutes })));
const ReviewsPage = () => (
  <Suspense fallback={null}>
    <ReviewsPageLazy />
  </Suspense>
);
const TrashPage = () => (
  <Suspense fallback={null}>
    <TrashPageLazy />
  </Suspense>
);
const DatasetsRoutes = () => (
  <Suspense fallback={null}>
    <DatasetsRoutesLazy />
  </Suspense>
);
import { RunDetailPage } from '@/features/run-detail/RunDetailPage';
import { ComparePage } from '@/features/compare/ComparePage';
import { AnalyzerPage } from '@/features/analyzer';
import { RunAnalyzerRedirect } from '@/features/analyzer/RunAnalyzerRedirect';

const C = ROUTES.projectChildren;

/** Placeholder routes for every current URL (brief 01 §8). Area agents replace the elements. */
const projectChildren: RouteObject[] = [
  { index: true, element: <RunsPage /> },
  { path: C.overview, element: <OverviewPage /> },
  { path: C.charts, element: <ChartsPage /> },
  { path: C.models, element: <ComingSoon brief="06-experiments-eval-queue" title="Models" /> },
  { path: C.experimentsQueue, element: <ComingSoon brief="06-experiments-eval-queue" title="Eval queue" /> },
  { path: C.experiments, element: <ComingSoon brief="06-experiments-eval-queue" title="Experiments" /> },
  { path: C.experimentsSplat, element: <ComingSoon brief="06-experiments-eval-queue" title="Experiment" /> },
  { path: C.environments, element: <ComingSoon brief="06-experiments-eval-queue" title="Environments" /> },
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
