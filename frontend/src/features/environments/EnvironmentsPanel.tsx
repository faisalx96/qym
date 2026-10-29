/**
 * Project settings -> Environments tab: the list with "+ Add environment". A row opens the one environment
 * page (`/projects/:slug/environments/:id?from=settings`, whose back link returns here). The legacy deep link
 * `?tab=environments&env=<id>[&promote=run|job&id=<id>]` redirects there; with `promote` it goes straight to the
 * default-preset editor.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useProjectContext } from '@/features/shell';
import { defaultPresetEditPath, environmentPath } from '@/features/experiments/paths';
import { useSearchParamsState } from '@/lib/url-state';
import { Button, Text } from '@/ui';
import { projectPath } from '@/app/routes';
import { AddEnvironmentDialog } from './AddEnvironmentDialog';
import { EnvironmentsList } from './EnvironmentsList';
import styles from './EnvironmentPage.module.css';

export function EnvironmentsPanel() {
  const { project, slug, canManage, readOnly } = useProjectContext();
  const navigate = useNavigate();
  const { params } = useSearchParamsState();
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
  const fromSettings = (id: string) => `${environmentPath(slug, id)}?from=settings`;

  if (envId && !handingOff) return <Navigate replace to={fromSettings(envId)} />;

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
        rowHref={(env) => fromSettings(env.id)}
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
