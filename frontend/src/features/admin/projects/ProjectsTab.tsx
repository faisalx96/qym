import { useAllProjects } from '@/api/admin';
import { CreateProjectDialog } from '@/features/shell/dialogs';
import { useDelayedPending } from '@/lib/pending';
import { Button, ErrorState, SearchField, SectionHeader, Skeleton, Stack, Text } from '@/ui';
import { useState } from 'react';
import { ProjectsTable } from './ProjectsTable';

export function ProjectsTab() {
  const projects = useAllProjects();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const skeleton = useDelayedPending(projects.isPending);
  const q = query.trim().toLowerCase();
  const shown = projects.data?.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
  );
  return (
    <Stack gap="md">
      <SectionHeader
        title="Projects"
        description={projects.data ? `${projects.data.length} projects, including archived` : undefined}
        aside={
          <Button variant="primary" onPress={() => setCreating(true)} data-new-project>
            New project
          </Button>
        }
      />
      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} compact />
      ) : projects.isPending ? (
        skeleton ? (
          <Skeleton kind="table" rows={3} label="Loading projects" />
        ) : null
      ) : (
        <>
          {projects.data.length > 8 ? (
            <SearchField
              label="Filter projects"
              placeholder="Filter by name or slug"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
              width={320}
            />
          ) : null}
          {q && shown && shown.length === 0 ? (
            <Text variant="sm" role="status">
              No projects match “{query.trim()}”.
            </Text>
          ) : (
            <ProjectsTable projects={shown ?? projects.data} />
          )}
        </>
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </Stack>
  );
}
