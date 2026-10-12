/** /projects/:slug/environments/:envId (brief 06 §2.9): the environment as a page. */
import { useNavigate } from 'react-router-dom';
import { useEvalEnvironment } from '@/api/evalEnvironments';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { useCrumbLabel } from '@/lib/crumb-label';
import { fullWidth } from '@/features/shell/layout';
import { Icon, LinkButton, PageHeader, Tag } from '@/ui';
import { ExperimentsTabs } from '@/features/experiments/ExperimentsTabs';
import { environmentsPath } from '@/features/experiments/paths';
import { EnvironmentPanelBody } from './EnvironmentPanelBody';
import styles from './EnvironmentPage.module.css';

export function EnvironmentPage({ environmentId }: { environmentId: string }) {
  const { project, slug } = useProjectContext();
  const navigate = useNavigate();
  const query = useEvalEnvironment(project.id, environmentId);
  const env = query.data;
  useDocumentTitle(`${project.name} · ${env?.name ?? 'Environment'}`);
  useCrumbLabel(env?.name);
  return (
    <div className={fullWidth} data-environment-page>
      <PageHeader
        title={env?.name ?? 'Environment'}
        description={env?.base_url}
        meta={
          env && !env.is_active
            ? [
                <Tag key="off" tone="warning">
                  Disabled
                </Tag>,
              ]
            : undefined
        }
        actions={
          <LinkButton
            to={environmentsPath(slug)}
            icon={<Icon name="prev" size={12} />}
            className={styles.pageBack}
          >
            All environments
          </LinkButton>
        }
        tabs={<ExperimentsTabs current="environments" />}
      />
      <EnvironmentPanelBody
        environmentId={environmentId}
        onDeleted={() => navigate(environmentsPath(slug))}
      />
    </div>
  );
}
