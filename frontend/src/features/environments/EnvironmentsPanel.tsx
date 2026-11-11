/**
 * Project settings -> Environments tab: the list with "Add environment" on the card's title row. A row opens the
 * one environment page (`/projects/:slug/environments/:id?from=settings`, whose back link returns here). The legacy
 * deep link `?tab=environments&env=<id>[&promote=run|job&id=<id>]` redirects there; with `promote` it goes straight
 * to the default-preset editor.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useProjectContext } from '@/features/shell';
import { defaultPresetEditPath, environmentPath } from '@/features/experiments/paths';
import { useSearchParamsState } from '@/lib/url-state';
import { Button, Icon } from '@/ui';
import { SettingsCard } from '@/features/shell/settings/SettingsCard';
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
    <div className={styles.body}>
      {/* One Add button, on the card's title row; the empty list does not repeat it. */}
      <SettingsCard
        title="Environments"
        description={
          canManage
            ? 'Evaluation Service deployments that experiments launch jobs on.'
            : 'Evaluation Service deployments that experiments launch jobs on. Only project managers and admins can add or change them.'
        }
        action={
          canAdd ? (
            <Button variant="primary" icon={<Icon name="plus" size={12} />} onPress={() => setAdding(true)}>
              Add environment
            </Button>
          ) : undefined
        }
        data-environments-panel
      >
        <EnvironmentsList
          projectId={project.id}
          slug={slug}
          canManage={canManage}
          readOnly={readOnly}
          rowHref={(env) => fromSettings(env.id)}
        />
      </SettingsCard>
      {canAdd ? (
        <AddEnvironmentDialog
          projectId={project.id}
          open={adding}
          onOpenChange={setAdding}
          apiKeysTo={`${projectPath(slug, 'settings')}?tab=apikeys`}
        />
      ) : null}
    </div>
  );
}
