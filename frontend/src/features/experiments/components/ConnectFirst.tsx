/**
 * With no active environment, the experiments list and the launch page lead straight to "Add environment", which
 * opens the dialog in place (C121), instead of a second "New experiment" and a dead end on the environments page.
 * A member who may not add one is sent to the environments list.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EvalEnvironment } from '@/api/evalCommon';
import { projectPath } from '@/app/routes';
import { AddEnvironmentDialog } from '@/features/environments/AddEnvironmentDialog';
import { useProjectContext } from '@/features/shell';
import { Button, EmptyState, Icon, LinkButton } from '@/ui';
import { environmentsPath } from '../paths';

export function ConnectFirst({ onCreated }: { onCreated: (env: EvalEnvironment) => void }) {
  const { project, slug, canManage, readOnly } = useProjectContext();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const canAdd = canManage && !readOnly;
  return (
    <>
      <EmptyState
        icon={<Icon name="flask" />}
        title="Connect an Evaluation Service first"
        body={
          canAdd
            ? 'An experiment runs on an Evaluation Service environment. Add one here, then launch.'
            : 'An experiment runs on an Evaluation Service environment. Ask a project manager to add one.'
        }
        action={
          canAdd ? (
            <Button
              variant="accent"
              icon={<Icon name="plus" size={12} />}
              onPress={() => setAdding(true)}
              data-testid="connect-first-add"
            >
              Add environment
            </Button>
          ) : (
            <LinkButton to={environmentsPath(slug)} variant="neutral">
              See environments
            </LinkButton>
          )
        }
      />
      {canAdd ? (
        <AddEnvironmentDialog
          projectId={project.id}
          open={adding}
          onOpenChange={setAdding}
          onCreated={onCreated}
          onGotoApiKeys={() => {
            setAdding(false);
            navigate(`${projectPath(slug, 'settings')}?tab=apikeys`);
          }}
        />
      ) : null}
    </>
  );
}
