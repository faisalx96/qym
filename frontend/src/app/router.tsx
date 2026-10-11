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
import { RunsPage, OverviewPage, ChartsPage } from '@/features/runs-list';

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
  { path: C.datasets, element: <ComingSoon brief="07-datasets-reviews-trash" title="Datasets" /> },
  { path: C.datasetsSplat, element: <ComingSoon brief="07-datasets-reviews-trash" title="Dataset" /> },
  { path: C.analysis, element: <ComingSoon brief="08-playground" title="Auto-analysis" /> },
  { path: C.reviews, element: <ComingSoon brief="07-datasets-reviews-trash" title="Reviews" /> },
  { path: C.settings, element: <ProjectSettingsPage /> },
  { path: C.runs_detail, element: <ComingSoon brief="04-run-detail" title="Run" /> },
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
          { path: ROUTES.admin, element: <ComingSoon brief="09-admin-docs" title="Admin" /> },
          { path: ROUTES.adminSplat, element: <ComingSoon brief="09-admin-docs" title="Admin" /> },
          {
            path: ROUTES.trash,
            element: <ComingSoon brief="07-datasets-reviews-trash" title="Deleted runs" />,
          },
          { path: ROUTES.compare, element: <ComingSoon brief="05-compare-analyzer" title="Compare" /> },
          { path: ROUTES.reviews, element: <ComingSoon brief="07-datasets-reviews-trash" title="Reviews" /> },
          { path: ROUTES.docs, element: <ComingSoon brief="09-admin-docs" title="Docs" /> },
          { path: ROUTES.docsNew, element: <ComingSoon brief="09-admin-docs" title="Docs" /> },
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
