import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { adminKeys } from '@/api/admin';
import type { Project } from '@/api/types';
import { projectPath } from '@/app/routes';
import { ArchiveProjectDialog, UnarchiveProjectDialog } from '@/features/shell/dialogs';
import { Badge, DataTable, Identicon, SearchField, Text, type Column } from '@/ui';
import styles from './projects.module.css';

export interface ProjectsTableProps {
  projects: Project[];
}

/** All projects incl. archived; Archive/Unarchive use the foundation preview dialogs. */
export function ProjectsTable({ projects }: ProjectsTableProps) {
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [unarchiving, setUnarchiving] = useState<Project | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => void qc.invalidateQueries({ queryKey: adminKeys.projects });

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)),
    [projects, q],
  );
  const columns = useMemo<Column<Project>[]>(
    () => [
      {
        id: 'name',
        header: 'Project',
        flex: true,
        minWidth: 180,
        sort: { key: 'name', compare: (a, b) => a.name.localeCompare(b.name) },
        accessor: (p) => p.name,
        pin: 'start',
        hideable: false,
        priority: 1,
        cell: (p) => (
          <span className={styles.nameCell}>
            <Identicon seed={p.slug} cell={5} gap={2} chip />
            <Link to={projectPath(p.slug)}>{p.name}</Link>
          </span>
        ),
      },
      { id: 'slug', header: 'Slug', type: 'id', width: 160, priority: 2, cell: (p) => p.slug },
      {
        id: 'status',
        header: 'Status',
        type: 'status',
        width: 110,
        priority: 1,
        cell: (p) =>
          p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Archived</Badge>,
      },
      {
        id: 'members',
        header: 'Members',
        type: 'number',
        sort: 'members',
        accessor: (p) => p.member_count,
        width: 90,
        priority: 2,
        cell: (p) => p.member_count,
      },
      {
        id: 'runs',
        header: 'Runs',
        type: 'number',
        sort: 'runs',
        accessor: (p) => p.run_count,
        width: 80,
        priority: 2,
        cell: (p) => p.run_count,
      },
    ],
    [],
  );

  return (
    <>
      <DataTable<Project>
        aria-label="Projects"
        columns={columns}
        rows={shown}
        rowKey={(p) => p.id}
        storageKey="admin-projects"
        density="regular"
        empty="No projects yet."
        isFiltered={q !== ''}
        filteredEmpty={<Text variant="sm">No projects match “{query.trim()}”.</Text>}
        rowActions={(p) => [
          {
            id: 'settings',
            label: `Settings for ${p.name}`,
            icon: 'settings',
            primary: true,
            onPress: () => navigate(projectPath(p.slug, 'settings')),
          },
          p.is_active
            ? {
                id: 'archive',
                label: `Archive ${p.name}`,
                icon: 'archive',
                primary: true,
                danger: true,
                onPress: () => setArchiving(p),
              }
            : {
                id: 'unarchive',
                label: `Unarchive ${p.name}`,
                icon: 'retry',
                primary: true,
                onPress: () => setUnarchiving(p),
              },
        ]}
      >
        <DataTable.Toolbar
          columnsMenu={false}
          search={
            <SearchField
              label="Filter projects"
              placeholder="Filter by name or slug"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
              width={320}
            />
          }
        />
        <DataTable.Footer
          summary={q ? `${shown.length} of ${projects.length} projects` : `${projects.length} projects`}
        />
      </DataTable>
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
