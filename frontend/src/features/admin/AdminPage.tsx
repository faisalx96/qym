import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAdminUsers, useAllProjects, useMaintenance } from '@/api/admin';
import { ADMIN_TABS, type AdminTab } from '@/app/routes';
import { useDocumentTitle } from '@/features/shell/hooks';
import { constrained } from '@/features/shell/layout';
import { Icon, PageHeader, StatStrip, TabPanel, Tabs } from '@/ui';
import { plural } from '@/features/shell/plural';
import { FeedbackAgentTab } from './feedback/FeedbackAgentTab';
import { MaintenanceTab } from './maintenance/MaintenanceTab';
import { ProjectsTab } from './projects/ProjectsTab';
import { RunsTab } from './runs/RunsTab';
import { UsersTab } from './users/UsersTab';
import styles from './AdminPage.module.css';
import { APP_LOCALE } from '@/lib/dates';

/** /admin/:tab — tab is a path segment; /admin → /admin/runs; unknown → /admin/runs. */
export function AdminPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const selected = ADMIN_TABS.find((t) => t === tab);
  useDocumentTitle('Admin');
  const users = useAdminUsers();
  const projects = useAllProjects();
  const maint = useMaintenance(selected === 'maintenance');
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(''), 8000);
    return () => clearTimeout(t);
  }, [status]);
  if (!selected) return <Navigate to="/admin/runs" replace />;
  const archived = projects.data?.filter((p) => !p.is_active) ?? [];
  const disabled = users.data?.filter((u) => !u.is_active).length ?? 0;
  const runs = projects.data?.reduce((n, p) => n + p.run_count, 0);
  const activeJobs = maint.data?.jobs.filter((j) =>
    ['queued', 'running', 'cancel_requested'].includes(j.status),
  ).length;
  return (
    <div className={constrained} data-admin-page>
      <PageHeader
        title="Admin"
        description="Platform-wide runs, projects, users, maintenance and the feedback assistant."
      />
      <p className={styles.srOnly} role="status" aria-live="polite" data-status-line>
        {status}
      </p>
      {/* The platform totals as the band of tiles the project Overview uses (label, value, a line of context), the same
          on every tab so the tabs never move. Round 10: the one-line compact strip was hard to read. */}
      <div className={styles.totals}>
        <StatStrip
          aria-label="Platform totals"
          items={[
            {
              key: 'users',
              label: 'Users',
              icon: <Icon name="user" />,
              value: users.data?.length ?? '—',
              sub: users.data ? (disabled ? plural(disabled, 'disabled user') : 'All active') : undefined,
            },
            {
              key: 'projects',
              label: 'Projects',
              icon: <Icon name="folder" />,
              value: projects.data?.length ?? '—',
              sub: projects.data
                ? archived.length
                  ? plural(archived.length, 'archived project')
                  : 'None archived'
                : undefined,
            },
            {
              key: 'runs',
              label: 'Runs',
              icon: <Icon name="chart" />,
              tone: 'accent',
              value: runs !== undefined ? runs.toLocaleString(APP_LOCALE) : '—',
              sub: archived.length
                ? `All projects, incl. ${archived.reduce((n, p) => n + p.run_count, 0).toLocaleString(APP_LOCALE)} archived`
                : 'All projects',
              help: 'Sum of every project’s run count, including archived projects. Deleted runs are excluded. The lists below only show active projects.',
            },
          ]}
        />
      </div>
      <Tabs
        label="Admin sections"
        items={[
          { id: 'runs', label: 'Runs' },
          { id: 'projects', label: 'Projects', count: projects.data?.length },
          { id: 'users', label: 'Users', count: users.data?.length },
          { id: 'maintenance', label: 'Maintenance', count: activeJobs || undefined },
          { id: 'feedback', label: 'Feedback assistant' },
        ]}
        selected={selected}
        onSelect={(id) => navigate(`/admin/${id as AdminTab}`)}
      >
        <TabPanel id="runs">{selected === 'runs' ? <RunsTab announce={setStatus} /> : null}</TabPanel>
        <TabPanel id="projects">{selected === 'projects' ? <ProjectsTab /> : null}</TabPanel>
        <TabPanel id="users">{selected === 'users' ? <UsersTab /> : null}</TabPanel>
        <TabPanel id="maintenance">{selected === 'maintenance' ? <MaintenanceTab /> : null}</TabPanel>
        <TabPanel id="feedback">{selected === 'feedback' ? <FeedbackAgentTab /> : null}</TabPanel>
      </Tabs>
    </div>
  );
}
