import { useLiveSources } from '@/api/live';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ErrorState, PageHeader, Skeleton, Text } from '@/ui';
import { LiveEmptyState } from './LiveEmptyState';
import { LiveOverviewPage } from './LiveOverviewPage';
import styles from './live.module.css';

function LiveRoute({ title }: { title: string }) {
  const { slug, project } = useProjectContext();
  useDocumentTitle(`${project.name} · ${title}`);
  const query = useLiveSources(slug);
  const showSkeleton = useDelayedPending(query.isPending);

  return (
    <div className={`${fullWidth} ${styles.page}`}>
      <PageHeader title={title} />
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load live sources"
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending || showSkeleton ? (
        showSkeleton ? (
          <Skeleton kind="lines" rows={3} label="Loading live sources" />
        ) : null
      ) : query.data.sources.length === 0 ? (
        <LiveEmptyState />
      ) : (
        <Text tone="muted">Coming in the next task</Text>
      )}
    </div>
  );
}

export function LiveOverviewRoute() {
  const { slug } = useProjectContext();
  const query = useLiveSources(slug);
  const { get } = useSearchParamsState();
  const source = get('source') || query.data?.default_source || query.data?.sources[0]?.key;
  if (query.data?.sources.length && source) {
    return (
      <LiveOverviewPage
        slug={slug}
        source={source}
        day={get('day') || new Date().toISOString().slice(0, 10)}
      />
    );
  }
  return <LiveRoute title="Live evaluation" />;
}

export function LiveTurnsRoute() {
  return <LiveRoute title="Turns" />;
}

export function LiveTurnRoute() {
  return <LiveRoute title="Turn" />;
}
