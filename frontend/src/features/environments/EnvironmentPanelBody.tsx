/**
 * Everything about one environment: Status, Schema, LLM model groups, Presets, Ranking, Policies,
 * Connection and the Delete / Save footer. Rendered as the environment page and inside the
 * project-settings drawer.
 */
import { useState } from 'react';
import { useEvalEnvironment } from '@/api/evalEnvironments';
import { useDelayedPending } from '@/lib/pending';
import { useProjectContext } from '@/features/shell';
import { ErrorState, Skeleton } from '@/ui';
import styles from './EnvironmentPage.module.css';
import { SchemaSection, SlotsSection, StatusSection } from './EnvironmentSections';
import { PresetsSection } from './PresetsSection';
import { SettingsForm } from './SettingsForm';

export interface EnvironmentPanelBodyProps {
  environmentId: string;
  /** Present in a drawer: adds a Close button to the footer and is called after a delete. */
  onClose?: () => void;
  onDeleted?: () => void;
}

export function EnvironmentPanelBody({ environmentId, onClose, onDeleted }: EnvironmentPanelBodyProps) {
  const { project, slug, canManage, readOnly } = useProjectContext();
  const query = useEvalEnvironment(project.id, environmentId);
  const showSkeleton = useDelayedPending(query.isPending);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const canEdit = canManage && !readOnly;

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="Could not load the environment"
        notFoundMessage="This environment does not exist in this project, or it was deleted."
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isPending) return showSkeleton ? <Skeleton kind="cards" count={3} label="Loading environment" /> : null;

  const env = query.data;
  return (
    <div className={styles.body} data-env-body={env.id}>
      <StatusSection projectId={project.id} env={env} canEdit={canEdit} />
      <SchemaSection projectId={project.id} env={env} canEdit={canEdit} onNeedsGrouping={() => setSlotsOpen(true)} />
      <SlotsSection projectId={project.id} env={env} canEdit={canEdit} dialogOpen={slotsOpen} onDialogOpenChange={setSlotsOpen} />
      <PresetsSection projectId={project.id} slug={slug} env={env} canEdit={canEdit} />
      <SettingsForm
        key={env.id}
        projectId={project.id}
        env={env}
        canEdit={canEdit}
        onClose={onClose}
        onDeleted={() => (onDeleted ?? onClose)?.()}
      />
    </div>
  );
}
