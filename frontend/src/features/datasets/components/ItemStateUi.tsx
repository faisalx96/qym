/** Item state UI shared by the docked pane and the item page (spec A2-13 to A2-28). */
import { useDisableItem, useEnableItem, type DatasetItem, type DatasetVersion } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { Button, useToast } from '@/ui';
import { formatDate } from '../lib/itemValue';
import { Note } from './Note';

/** "Disabled by Noura on Oct 20, 2026" with the reason and, on a published version, what it means. */
export function DisabledBanner({ item, published }: { item: DatasetItem; published: boolean }) {
  const by = item.disabled?.by;
  const who = by ? by.display_name || by.email : 'someone';
  const reason = item.disabled?.reason?.trim();
  return (
    <Note
      tone="warning"
      icon="warning"
      data-testid="disabled-banner"
      title={`Disabled by ${who} on ${formatDate(item.disabled?.at, 'date')}`}
    >
      <span>{reason ? `Reason: ${reason}` : 'No reason given'}</span>
      {published ? <span>Runs on this version skip it. Create a draft to change that.</span> : null}
    </Note>
  );
}

/** Disable / enable one item of a draft, with the toasts the spec words. */
export function useItemStateActions(slug: string, datasetRef: string, version: DatasetVersion) {
  const toast = useToast();
  const disable = useDisableItem(slug, datasetRef, version.version);
  const enable = useEnableItem(slug, datasetRef, version.version);
  return {
    enabling: enable.isPending,
    /** Throws with the server detail so the dialog can show it under the field. */
    async disableItem(itemId: string, reason: string): Promise<void> {
      await disable.mutateAsync({ itemId, reason: reason || undefined });
      toast.show(`Item ${itemId} disabled`, { tone: 'success' });
    },
    async enableItem(itemId: string): Promise<void> {
      try {
        await enable.mutateAsync({ itemId });
        toast.show(`Item ${itemId} enabled`, { tone: 'success' });
      } catch (e) {
        toast.show(e instanceof ApiError ? e.detail || e.message : 'Couldn’t enable the item', {
          tone: 'error',
        });
      }
    },
  };
}

/** The Enable button under the banner (drafts only). */
export function EnableButton({
  onPress,
  loading,
  size = 'sm',
}: {
  onPress: () => void;
  loading: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <Button variant="neutral" size={size} loading={loading} onPress={onPress} data-testid="enable-item">
      Enable
    </Button>
  );
}
