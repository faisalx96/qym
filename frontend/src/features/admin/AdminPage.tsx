import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAdminUsers, useAllProjects, useMaintenance } from '@/api/admin';
import { ADMIN_TABS, type AdminTab } from '@/app/routes';
import { useDocumentTitle } from '@/features/shell/hooks';
import { constrained } from '@/features/shell/layout';
import { PageHeader, StatStrip, TabPanel, Tabs } from '@/ui';
import { MaintenanceTab } from './maintenance/MaintenanceTab';
import { ProjectsTab } from './projects/ProjectsTab';
import { RunsTab } from './runs/RunsTab';
import { UsersTab } from './users/UsersTab';
import styles from './AdminPage.module.css';

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
  const runs = projects.data?.reduce((n, p) => n + p.run_count, 0);
  const activeJobs = maint.data?.jobs.filter((j) => ['queued', 'running', 'cancel_requested'].includes(j.status)).length;
  return (
    <div className={constrained} data-admin-page>
      <PageHeader title="Admin" description="Platform-wide runs, projects, users and maintenance." />
      <p className={styles.srOnly} role="status" aria-live="polite" data-status-line>
        {status}
      </p>
      {selected === 'runs' ? (
        <StatStrip
          aria-label="Platform totals"
          items={[
            { label: 'Users', value: users.data?.length ?? '—', sub: users.data ? `${users.data.filter((u) => !u.is_active).length} disabled` : undefined },
            { label: 'Projects', value: projects.data?.length ?? '—', sub: projects.data ? `${archived.length} archived` : undefined },
            {
              label: 'Runs, all projects',
              value: runs ?? '—',
              sub: archived.length ? `incl. ${archived.reduce((n, p) => n + p.run_count, 0)} in archived projects` : undefined,
              help: 'Sum of every project’s run count, including archived projects. Deleted runs are excluded. The lists below only show active projects.',
            },
          ]}
        />
      ) : null}
      <Tabs
        label="Admin sections"
        items={[
          { id: 'runs', label: 'Runs' },
          { id: 'projects', label: 'Projects', count: projects.data?.length },
          { id: 'users', label: 'Users', count: users.data?.length },
          { id: 'maintenance', label: 'Maintenance', count: activeJobs || undefined },
        ]}
        selected={selected}
        onSelect={(id) => navigate(`/admin/${id as AdminTab}`)}
      >
        <TabPanel id="runs">{selected === 'runs' ? <RunsTab announce={setStatus} /> : null}</TabPanel>
        <TabPanel id="projects">{selected === 'projects' ? <ProjectsTab /> : null}</TabPanel>
        <TabPanel id="users">{selected === 'users' ? <UsersTab /> : null}</TabPanel>
        <TabPanel id="maintenance">{selected === 'maintenance' ? <MaintenanceTab /> : null}</TabPanel>
      </Tabs>
    </div>
  );
}
