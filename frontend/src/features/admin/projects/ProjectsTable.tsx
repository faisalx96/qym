import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { adminKeys } from '@/api/admin';
import type { Project } from '@/api/types';
import { projectPath } from '@/app/routes';
import { ArchiveProjectDialog, UnarchiveProjectDialog } from '@/features/shell/dialogs';
import { Badge, Button, DataTable, Identicon, type Column } from '@/ui';
import styles from './projects.module.css';

export interface ProjectsTableProps {
  projects: Project[];
}

/** All projects incl. archived; Archive/Unarchive use the foundation preview dialogs. */
export function ProjectsTable({ projects }: ProjectsTableProps) {
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [unarchiving, setUnarchiving] = useState<Project | null>(null);
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: adminKeys.projects });

  const columns = useMemo<Column<Project>[]>(
    () => [
      {
        id: 'name',
        label: 'Project',
        flex: true,
        minWidth: 180,
        cell: (p) => (
          <span className={styles.nameCell}>
            <Identicon seed={p.slug} cell={5} gap={2} chip />
            <Link to={projectPath(p.slug)}>{p.name}</Link>
          </span>
        ),
      },
      { id: 'slug', label: 'Slug', width: 160, mono: true, cell: (p) => p.slug },
      {
        id: 'status',
        label: 'Status',
        width: 110,
        cell: (p) =>
          p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Archived</Badge>,
      },
      { id: 'members', label: 'Members', width: 90, align: 'end', mono: true, cell: (p) => p.member_count },
      { id: 'runs', label: 'Runs', width: 80, align: 'end', mono: true, cell: (p) => p.run_count },
      {
        id: 'actions',
        label: 'Actions',
        hideLabel: true,
        width: 230,
        resizable: false,
        align: 'end',
        cell: (p) => (
          <span className={styles.rowActions}>
            <Link to={projectPath(p.slug, 'settings')}>Settings</Link>
            {p.is_active ? (
              <Button
                variant="ghost"
                onPress={() => setArchiving(p)}
                aria-label={`Archive ${p.name}`}
                data-project-archive={p.id}
              >
                Archive
              </Button>
            ) : (
              <Button
                variant="neutral"
                onPress={() => setUnarchiving(p)}
                aria-label={`Unarchive ${p.name}`}
                data-project-unarchive={p.id}
              >
                Unarchive
              </Button>
            )}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        aria-label="Projects"
        columns={columns}
        rows={projects}
        rowKey={(p) => p.id}
        storageKey="admin-projects"
        emptyState="No projects yet."
      />
      {archiving ? (
        <ArchiveProjectDialog
          project={archiving}
          open
          onOpenChange={(o) => !o && setArchiving(null)}
          onArchived={refresh}
        />
      ) : null}
      {unarchiving ? (
        <UnarchiveProjectDialog
          project={unarchiving}
          open
          onOpenChange={(o) => {
            if (!o) {
              setUnarchiving(null);
              refresh();
            }
          }}
        />
      ) : null}
    </>
  );
}
