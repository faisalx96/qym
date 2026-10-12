import { useAllProjects } from '@/api/admin';
import { CreateProjectDialog } from '@/features/shell/dialogs';
import { useDelayedPending } from '@/lib/pending';
import { Button, ErrorState, SectionHeader, Skeleton, Stack } from '@/ui';
import { useState } from 'react';
import { ProjectsTable } from './ProjectsTable';

export function ProjectsTab() {
  const projects = useAllProjects();
  const [creating, setCreating] = useState(false);
  const skeleton = useDelayedPending(projects.isPending);
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
        <ProjectsTable projects={projects.data} />
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </Stack>
  );
}
