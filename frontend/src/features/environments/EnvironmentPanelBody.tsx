/**
 * Everything about one environment: Status, Schema, Tasks, LLM model groups, Presets, Ranking, Policies,
 * Connection and the Delete / Save footer. The only host is the environment page (one route for the
 * Experiments and the Project settings entries).
 */
import { useState } from 'react';
import { useEvalEnvironment } from '@/api/evalEnvironments';
import { useDelayedPending } from '@/lib/pending';
import { useProjectContext } from '@/features/shell';
import { environmentsPath } from '@/features/experiments/paths';
import { ErrorState, Skeleton } from '@/ui';
import styles from './EnvironmentPage.module.css';
import { SchemaSection, SlotsSection, StatusSection, TasksSection } from './EnvironmentSections';
import { PresetsSection } from './PresetsSection';
import { SettingsForm } from './SettingsForm';

export interface EnvironmentPanelBodyProps {
  environmentId: string;
  onDeleted?: () => void;
}

export function EnvironmentPanelBody({ environmentId, onDeleted }: EnvironmentPanelBodyProps) {
  const { project, slug, canManage, readOnly } = useProjectContext();
  const query = useEvalEnvironment(project.id, environmentId);
  const showSkeleton = useDelayedPending(query.isPending);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const canEdit = canManage && !readOnly;

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="Couldn’t load the environment"
        notFoundTitle="Environment not found"
        notFoundMessage="This environment does not exist in this project, or it was deleted."
        parent={{ to: environmentsPath(slug), label: 'Environments' }}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isPending)
    return showSkeleton ? <Skeleton kind="cards" count={3} label="Loading environment" /> : null;

  const env = query.data;
  return (
    <div className={styles.body} data-env-body={env.id} data-part="env-page">
      <StatusSection projectId={project.id} env={env} canEdit={canEdit} />
      <SchemaSection
        projectId={project.id}
        env={env}
        canEdit={canEdit}
        onNeedsGrouping={() => setSlotsOpen(true)}
      />
      <TasksSection projectId={project.id} env={env} />
      <SlotsSection
        projectId={project.id}
        env={env}
        canEdit={canEdit}
        dialogOpen={slotsOpen}
        onDialogOpenChange={setSlotsOpen}
      />
      <PresetsSection projectId={project.id} slug={slug} env={env} canEdit={canEdit} />
      <SettingsForm
        key={env.id}
        projectId={project.id}
        env={env}
        canEdit={canEdit}
        onDeleted={() => onDeleted?.()}
      />
    </div>
  );
}
