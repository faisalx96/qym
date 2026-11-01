import { EmptyState, LinkButton } from '@/ui';

export function LiveEmptyState() {
  return (
    <EmptyState
      title="No live source yet"
      body="A live evaluation worker pushes every production turn here as it is evaluated."
      action={<LinkButton to="/docs/platform-guide/live">Read the ingest guide</LinkButton>}
    />
  );
}
