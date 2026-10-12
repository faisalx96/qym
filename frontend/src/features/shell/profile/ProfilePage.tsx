import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import { useDocumentTitle } from '../hooks';
import { constrained } from '../layout';
import { projectPath } from '@/app/routes';
import { api, ApiError } from '@/lib/http';
import {
  Button,
  DataTable,
  Identicon,
  KeyValueGrid,
  PageHeader,
  SectionHeader,
  Stack,
  Tag,
  Text,
  TextField,
  useToast,
  type Column,
} from '@/ui';
import type { Project } from '@/api/types';
import styles from './ProfilePage.module.css';

const COLUMNS: Column<Project>[] = [
  {
    id: 'name',
    label: 'Project',
    flex: true,
    minWidth: 160,
    cell: (p) => (
      <span className={styles.projectCell}>
        <Identicon seed={p.slug} cell={5} gap={2} chip />
        <Link to={projectPath(p.slug)}>{p.name}</Link>
      </span>
    ),
  },
  { id: 'slug', label: 'Slug', width: 160, mono: true, cell: (p) => p.slug },
  { id: 'role', label: 'Role', width: 110, cell: (p) => <Tag kind="role">{p.role || 'member'}</Tag> },
  { id: 'runs', label: 'Runs', width: 80, align: 'end', mono: true, cell: (p) => p.run_count },
  {
    id: 'actions',
    label: 'Actions',
    hideLabel: true,
    width: 140,
    resizable: false,
    cell: (p) => (
      <span className={styles.actions}>
        <Link to={projectPath(p.slug)}>Open</Link>
        <Link to={projectPath(p.slug, 'settings')}>Settings</Link>
      </span>
    ),
  },
];

export function ProfilePage() {
  const { me, isAdmin, refetch } = useAuth();
  useDocumentTitle('Profile');
  return (
    <div className={constrained} data-profile-page>
      <PageHeader title="Profile" description="Your account and the projects you belong to." />
      <Stack gap="xl">
        <section>
          <SectionHeader title="Account" />
          <div className={styles.card}>
            <KeyValueGrid
              aria-label="Account"
              columns={2}
              items={[
                { key: 'display_name', label: 'Display name', value: me.display_name || '—' },
                { key: 'email', label: 'Email', value: me.email, mono: true },
                { key: 'role', label: 'Global role', value: <Tag kind="role">{me.role}</Tag> },
                {
                  key: 'default',
                  label: 'Default project',
                  value: me.default_project ? (
                    <Link to={projectPath(me.default_project.slug)}>{me.default_project.name}</Link>
                  ) : (
                    '—'
                  ),
                },
                { key: 'auth', label: 'Sign-in method', value: me.auth_type?.replace(/_/g, ' ') ?? '—' },
              ]}
            />
          </div>
        </section>
        {me.can_bootstrap_admin && !isAdmin ? <BootstrapAdminPanel onGranted={refetch} /> : null}
        <section>
          <SectionHeader
            title="Projects"
            description={`${me.projects.length} project${me.projects.length === 1 ? '' : 's'}`}
          />
          <DataTable
            aria-label="Your projects"
            columns={COLUMNS}
            rows={me.projects}
            rowKey={(p) => p.id}
            storageKey="profile-projects"
            emptyState="You are not a member of any project yet."
          />
        </section>
      </Stack>
    </div>
  );
}

function BootstrapAdminPanel({ onGranted }: { onGranted: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const grant = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; role: string }>('/v1/auth/bootstrap-admin', { bootstrap_token: token }),
    onSuccess: () => {
      toast.show('Admin access granted. Refreshing…', { tone: 'success' });
      setTimeout(() => window.location.reload(), 600);
      onGranted();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? e.detail || (e.status === 409 ? 'An admin already exists.' : 'Invalid token.')
          : String(e),
      ),
  });
  return (
    <section data-bootstrap-admin>
      <SectionHeader
        title="Grant admin access"
        description="Enter the bootstrap token from QYM_ADMIN_BOOTSTRAP_TOKEN to become the first administrator."
      />
      <form
        className={styles.bootstrapForm}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          grant.mutate();
        }}
      >
        <TextField
          label="Bootstrap token"
          hideLabel
          placeholder="Bootstrap token"
          value={token}
          onChange={setToken}
          mono
          width={320}
          errorMessage={error ?? undefined}
        />
        <Button type="submit" variant="primary" isDisabled={!token.trim()} loading={grant.isPending}>
          Grant admin
        </Button>
      </form>
      {error ? (
        <Text variant="sm" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </section>
  );
}
