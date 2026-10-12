/** /projects/:slug/environments (brief 06 §2.9): the Evaluation Service deployments of the project. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { projectPath } from '@/app/routes';
import { Button, PageHeader } from '@/ui';
import { ExperimentsTabs } from '@/features/experiments/ExperimentsTabs';
import { environmentPath } from '@/features/experiments/paths';
import { AddEnvironmentDialog } from './AddEnvironmentDialog';
import { EnvironmentsList } from './EnvironmentsList';

export function EnvironmentsPage() {
  const { project, slug, canManage, readOnly } = useProjectContext();
  useDocumentTitle(`${project.name} · Environments`);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const canAdd = canManage && !readOnly;
  return (
    <div className={fullWidth} data-environments-page>
      <PageHeader
        title="Environments"
        description={
          canManage
            ? 'Register Evaluation Service deployments; experiments launch jobs on them.'
            : 'Only project managers and admins can add or change environments.'
        }
        actions={
          canAdd ? (
            <Button variant="primary" size="md" onPress={() => setAdding(true)}>
              + Add environment
            </Button>
          ) : null
        }
        tabs={<ExperimentsTabs current="environments" />}
      />
      <EnvironmentsList
        projectId={project.id}
        slug={slug}
        canManage={canManage}
        readOnly={readOnly}
        storageKey="environments.list.v1"
        onOpen={(env) => navigate(environmentPath(slug, env.id))}
        onAdd={() => setAdding(true)}
      />
      {canAdd ? (
        <AddEnvironmentDialog
          projectId={project.id}
          open={adding}
          onOpenChange={setAdding}
          onGotoApiKeys={() => {
            setAdding(false);
            navigate(`${projectPath(slug, 'settings')}?tab=apikeys`);
          }}
        />
      ) : null}
    </div>
  );
}
