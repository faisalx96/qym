/**
 * Project settings -> Environments tab: the list with "+ Add environment" and the environment
 * detail drawer. Deep link `?tab=environments&env=<id>[&promote=run|job&id=<id>]` opens the
 * drawer; with `promote` it goes straight to the default-preset editor.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectContext } from '@/features/shell';
import { defaultPresetEditPath } from '@/features/experiments/paths';
import { useSearchParamsState } from '@/lib/url-state';
import { Button, Drawer, Text } from '@/ui';
import { useEvalEnvironment } from '@/api/evalEnvironments';
import { projectPath } from '@/app/routes';
import { AddEnvironmentDialog } from './AddEnvironmentDialog';
import { EnvironmentPanelBody } from './EnvironmentPanelBody';
import { EnvironmentsList } from './EnvironmentsList';
import styles from './EnvironmentPage.module.css';

function EnvironmentDrawer({ environmentId, onClose }: { environmentId: string; onClose: () => void }) {
  const { project } = useProjectContext();
  const env = useEvalEnvironment(project.id, environmentId);
  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={env.data?.name ?? 'Environment'}
      subtitle={env.data?.base_url}
      width={640}
    >
      <EnvironmentPanelBody environmentId={environmentId} onClose={onClose} />
    </Drawer>
  );
}

export function EnvironmentsPanel() {
  const { project, slug, canManage, readOnly } = useProjectContext();
  const navigate = useNavigate();
  const { params, replaceUrlQuery } = useSearchParamsState();
  const [adding, setAdding] = useState(false);
  const envId = params.get('env');
  const promote = params.get('promote');
  const promoteId = params.get('id');
  const canAdd = canManage && !readOnly;

  // `?promote=run|job&id=` hands off to the default-preset editor of that environment.
  useEffect(() => {
    if (envId && (promote === 'run' || promote === 'job' || promote === 'saved') && promoteId) {
      navigate(defaultPresetEditPath(slug, envId, { promote, id: promoteId }), { replace: true });
    }
  }, [envId, promote, promoteId, slug, navigate]);

  const handingOff = Boolean(envId && promote && promoteId);
  const open = (id: string) => replaceUrlQuery({ env: id, promote: null, id: null });
  const close = () => replaceUrlQuery({ env: null, promote: null, id: null });

  return (
    <div className={styles.body} data-environments-panel>
      <div className={styles.sectionHead}>
        <Text variant="base" tone="muted">
          {canManage
            ? 'Register Evaluation Service deployments; experiments launch jobs on them.'
            : 'Only project managers and admins can add or change environments.'}
        </Text>
        {canAdd ? (
          <Button variant="primary" size="md" onPress={() => setAdding(true)}>
            + Add environment
          </Button>
        ) : null}
      </div>
      <EnvironmentsList
        projectId={project.id}
        slug={slug}
        canManage={canManage}
        readOnly={readOnly}
        onOpen={(env) => open(env.id)}
        onAdd={() => setAdding(true)}
      />
      {envId && !handingOff ? <EnvironmentDrawer environmentId={envId} onClose={close} /> : null}
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
