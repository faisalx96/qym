import { useMemo, useState } from 'react';
import { canCreateProject } from '@/api/me';
import type { Project } from '@/api/types';
import { projectPath } from '@/app/routes';
import { Button, EmptyState, Icon, Identicon, PageHeader, SearchField, Tag, Text, Card } from '@/ui';
import { useAuth } from '../AuthContext';
import { useDocumentTitle } from '../hooks';
import { constrained } from '../layout';
import { CreateProjectDialog } from '../dialogs';
import styles from './ProjectsPage.module.css';

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
}

/** Projects landing: card grid filtered client-side by name/slug. */
export function ProjectsPage() {
  const { me } = useAuth();
  useDocumentTitle('Projects');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? me.projects.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
      : me.projects;
  }, [me.projects, query]);
  const canCreate = canCreateProject(me);

  return (
    <div className={constrained} data-projects-page>
      <PageHeader
        title="Projects"
        description={`${me.projects.length} project${me.projects.length === 1 ? '' : 's'} you belong to`}
        actions={
          <>
            <SearchField
              label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={setQuery}
              width={240}
            />
            {canCreate ? (
              <Button
                variant="primary"
                icon={<Icon name="plus" size={12} />}
                onPress={() => setCreating(true)}
                data-new-project
              >
                New project
              </Button>
            ) : null}
          </>
        }
      />
      {me.projects.length === 0 ? (
        <EmptyState
          icon={<Icon name="folder" />}
          title="No projects yet"
          body={
            canCreate
              ? 'Create a project to start collecting runs.'
              : 'Ask a project manager or an admin to add you to a project.'
          }
          action={
            canCreate ? (
              <Button variant="primary" onPress={() => setCreating(true)}>
                New project
              </Button>
            ) : undefined
          }
        />
      ) : projects.length === 0 ? (
        <EmptyState compact title="No matching projects" body={`Nothing matches “${query}”.`} />
      ) : (
        <ul className={styles.grid} aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id}>
              <ProjectCard project={p} />
            </li>
          ))}
        </ul>
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Card to={projectPath(project.slug)} className={styles.fill} data-project-card={project.slug}>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <Identicon seed={project.slug} chip />
          <div className={styles.cardTitle}>
            <Text variant="md" as="span" truncate>
              {project.name}
            </Text>
            <Text variant="sm" as="span" mono truncate>
              {project.slug}
            </Text>
          </div>
          <Tag kind="role">{project.role || 'member'}</Tag>
        </div>
        <div className={styles.cardMeta}>
          <span>
            <strong>{project.run_count}</strong> {project.run_count === 1 ? 'run' : 'runs'}
          </span>
          <span>
            <strong>{project.member_count}</strong> {project.member_count === 1 ? 'member' : 'members'}
          </span>
          <span>updated {relativeDate(project.updated_at)}</span>
        </div>
      </div>
    </Card>
  );
}
