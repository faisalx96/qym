import { useState, type ReactNode } from 'react';
import { SlotEditorDialog } from '@/features/environments/SlotEditor';
import { useLaunch } from '../LaunchContext';

/** The LLM-groups dialog of one environment; `reloadSlots` runs after it saved. */
export function useGroupsDialog(): { open: (envId: string) => void; node: ReactNode } {
  const { selectedEnvs, projectId, reloadSlots } = useLaunch();
  const [editing, setEditing] = useState<string | null>(null);
  const record = selectedEnvs.find((e) => e.id === editing);
  const node = record ? (
    <SlotEditorDialog
      projectId={projectId}
      env={record}
      open
      onOpenChange={(open) => {
        if (!open) setEditing(null);
      }}
      onSaved={() => void reloadSlots(record.id)}
    />
  ) : null;
  return { open: setEditing, node };
}
