import { EmptyState, Icon } from '@/ui';

export function LiveEmptyState() {
  return (
    <EmptyState
      icon={<Icon name="clock" />}
      title="No live source yet"
      body="A live evaluation worker pushes every production turn here as it is evaluated."
      guide="/docs/platform-guide/live"
    />
  );
}
