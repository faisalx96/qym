/** Experiments | Queue | Environments page tabs (brief 06 §2.1). Tabs are routes. */
import { useNavigate } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { useProjectContext } from '@/features/shell';
import { Tabs } from '@/ui';

export type ExperimentsSection = 'experiments' | 'queue' | 'environments';

export function ExperimentsTabs({ current }: { current: ExperimentsSection }) {
  const { slug } = useProjectContext();
  const navigate = useNavigate();
  const paths: Record<ExperimentsSection, string> = {
    experiments: projectPath(slug, 'experiments'),
    queue: projectPath(slug, 'experiments/queue'),
    environments: projectPath(slug, 'environments'),
  };
  return (
    <Tabs
      label="Experiments sections"
      selected={current}
      onSelect={(id) => navigate(paths[id as ExperimentsSection])}
      items={[
        { id: 'experiments', label: 'Experiments' },
        { id: 'queue', label: 'Queue' },
        { id: 'environments', label: 'Environments' },
      ]}
    />
  );
}
