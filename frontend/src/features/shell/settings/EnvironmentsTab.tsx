import { EmptyState, Icon, Tag } from '@/ui';

/** Owned by brief 06 (experiments / eval queue); mounted here as a placeholder. */
export function EnvironmentsTab() {
  return (
    <EmptyState
      compact
      icon={<Icon name="flask" />}
      title="Environments — coming soon"
      body={
        <>
          The eval environments panel is being rebuilt by the <Tag kind="data">06-experiments-eval-queue</Tag>{' '}
          area agent. Use the legacy settings page meanwhile.
        </>
      }
    />
  );
}
