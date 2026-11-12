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
import { formatAgo } from '@/lib/dates';

/** Freshness, then the day (lib/dates, C048). */
function relativeDate(iso: string): string {
  return formatAgo(iso);
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
      {me.projects.length > 0 ? (
        <div className={styles.toolbar}>
          <SearchField
            label="Search projects"
            placeholder="Search projects"
            value={query}
            onChange={setQuery}
            width="var(--search-width)"
            shortcut="/"
          />
        </div>
      ) : null}
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
            <Text variant="md" as="span">
              {project.name}
            </Text>
            <Text variant="sm" as="span" mono>
              {project.slug}
            </Text>
            <Tag kind="role" className={styles.role}>
              {project.role || 'member'}
            </Tag>
          </div>
        </div>
        <div className={styles.cardMeta}>
          <span>
            {project.run_count} {project.run_count === 1 ? 'run' : 'runs'}
          </span>
          <span>
            {project.member_count} {project.member_count === 1 ? 'member' : 'members'}
          </span>
          <span>updated {relativeDate(project.updated_at)}</span>
        </div>
      </div>
    </Card>
  );
}
