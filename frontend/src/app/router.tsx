import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { appBase, isDev } from '@/lib/runtime';
import { ROUTES } from './routes';
import { AppShell } from '@/features/shell/AppShell';
import { RequireAuth } from '@/features/shell/RequireAuth';
import { ProjectLayout } from '@/features/shell/ProjectLayout';
import { ProjectsPage } from '@/features/shell/projects/ProjectsPage';
import { LegacyRunRedirect } from '@/features/shell/LegacyRunRedirect';
import { NotFound } from '@/features/shell/NotFound';
import { RunsIndexRedirect } from '@/features/shell/RunsIndexRedirect';
import { ProjectRedirect } from '@/features/shell/ProjectRedirect';
import { RouteError } from '@/features/shell/RouteError';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { DocsRedirect } from '@/features/docs/DocsRedirect';
import { RunsPage } from '@/features/runs-list';
import { RunAnalyzerRedirect } from '@/features/analyzer/RunAnalyzerRedirect';
import { lazyPage } from './lazyPage';
import { loadRunDetailPage, runRouteLoader } from './prefetch';

// Heavy pages are fetched on first visit so the entry chunk stays small (see frontend/README.md). C079: settings (with
// its environment editors), profile and login load only when opened.
const LoginPage = lazyPage(() => import('@/features/shell/login/LoginPage'), 'LoginPage');
const ProfilePage = lazyPage(() => import('@/features/shell/profile/ProfilePage'), 'ProfilePage');
const ProjectSettingsPage = lazyPage(
  () => import('@/features/shell/settings/ProjectSettingsPage'),
  'ProjectSettingsPage',
);
const OverviewPage = lazyPage(() => import('@/features/runs-list/OverviewPage'), 'OverviewPage');
const ChartsPage = lazyPage(() => import('@/features/runs-list/ChartsPage'), 'ChartsPage');
const RunDetailPage = lazyPage(loadRunDetailPage, 'RunDetailPage');
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
const FeedbackIndexRoute = lazyPage(() => import('@/features/feedback/FeedbackRoutes'), 'FeedbackIndexRoute');
const FeedbackNewRoute = lazyPage(() => import('@/features/feedback/FeedbackRoutes'), 'FeedbackNewRoute');
const FeedbackItemRoute = lazyPage(() => import('@/features/feedback/FeedbackRoutes'), 'FeedbackItemRoute');
const LiveOverviewRoute = lazyPage(() => import('@/features/live/LiveRoutes'), 'LiveOverviewRoute');
const LiveWorkerRoute = lazyPage(() => import('@/features/live/LiveRoutes'), 'LiveWorkerRoute');
const LiveTurnsRoute = lazyPage(() => import('@/features/live/LiveRoutes'), 'LiveTurnsRoute');
const LiveTurnRoute = lazyPage(() => import('@/features/live/LiveRoutes'), 'LiveTurnRoute');

const C = ROUTES.projectChildren;

/** Project-scoped routes (brief 01 §8). */
const projectChildren: RouteObject[] = [
  { index: true, element: <RunsPage /> },
  { path: C.overview, element: <OverviewPage /> },
  { path: C.charts, element: <ChartsPage /> },
  // The Models page was removed (C052): old links land on Charts.
  { path: C.models, element: <Navigate to="../charts" replace /> },
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
  // A run URL trimmed to its list (C209); ranks above the run page's splat.
  { path: C.runsTrimmed, element: <RunsIndexRedirect /> },
  { path: C.live, element: <LiveOverviewRoute /> },
  { path: C.liveWorker, element: <LiveWorkerRoute /> },
  { path: C.liveTurns, element: <LiveTurnsRoute /> },
  { path: C.liveTurn, element: <LiveTurnRoute /> },
  {
    path: C.runs_detail,
    loader: runRouteLoader,
    // The loader returns at once (it only starts prefetches), so nothing needs to show while it runs. Without
    // this, every deep link to a run logs React Router's missing-HydrateFallback warning (C197).
    hydrateFallbackElement: null,
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
          { path: ROUTES.feedback, element: <FeedbackIndexRoute /> },
          { path: ROUTES.feedbackNew, element: <FeedbackNewRoute /> },
          { path: ROUTES.feedbackItem, element: <FeedbackItemRoute /> },
          {
            path: ROUTES.compare,
            element: (
              <ProjectRedirect page="compare">
                <ComparePage />
              </ProjectRedirect>
            ),
          },
          {
            path: ROUTES.reviews,
            element: (
              <ProjectRedirect page="reviews">
                <ReviewsPage />
              </ProjectRedirect>
            ),
          },
          { path: ROUTES.docs, element: <DocsRedirect /> },
          { path: ROUTES.docsIndex, element: <DocsRedirect /> },
          { path: ROUTES.docsPage, element: <DocsPage /> },
          { path: ROUTES.docsNew, element: <DocsRedirect /> },
          { path: ROUTES.legacyRun, element: <LegacyRunRedirect /> },
          // A trimmed project URL goes to the projects list (C209).
          { path: ROUTES.projectsIndex, element: <Navigate to="/" replace /> },
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
