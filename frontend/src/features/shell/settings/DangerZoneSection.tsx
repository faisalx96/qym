import { useState } from 'react';
import { useDeletionPreview } from '@/api/projects';
import type { DeletionPreview } from '@/api/types';
import { Button, Icon, Stack, Text } from '@/ui';
import { useProjectContext } from '../ProjectContext';
import { ArchiveProjectDialog, DeleteProjectDialog, UnarchiveProjectDialog } from '../dialogs';
import styles from './settings.module.css';
import { SettingsCard } from './SettingsCard';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The blocker of a delete, said in the Delete row itself: 'Blocked: 9 runs, 2 deleted runs' (C118). */
export function deleteBlocker(preview: DeletionPreview | undefined): string | null {
  if (!preview || preview.can_delete) return null;
  const runs = preview.counts.runs ?? 0;
  const deleted = preview.counts.runs_in_trash ?? 0;
  return `Blocked: ${plural(runs, 'run')}, ${plural(deleted, 'deleted run')}`;
}

/** Archive or delete the project: its own section at the end of General, a card like every other (round 11). */
export function DangerZoneSection() {
  const { project } = useProjectContext();
  const preview = useDeletionPreview(project.id);
  const blocker = deleteBlocker(preview.data);
  const [archive, setArchive] = useState(false);
  const [unarchive, setUnarchive] = useState(false);
  const [del, setDel] = useState(false);
  return (
    <Stack gap="lg">
      <SettingsCard
        id="danger-zone"
        title="Danger zone"
        description="Archive or delete this project. Only admins see this section."
        data-danger-zone
      >
        {project.is_active ? (
          <div className={styles.dangerRow}>
            <div>
              <Text variant="md">Archive this project</Text>
              <Text variant="sm">
                Read-only for everyone; API keys stop working; running runs are stopped. Reversible by an
                admin.
              </Text>
            </div>
            <Button variant="danger" size="md" onPress={() => setArchive(true)}>
              Archive
            </Button>
          </div>
        ) : (
          <div className={styles.dangerRow}>
            <div>
              <Text variant="md">Unarchive this project</Text>
              <Text variant="sm">Members can change the project again and active API keys work.</Text>
            </div>
            <Button variant="accent" size="md" onPress={() => setUnarchive(true)}>
              Unarchive
            </Button>
          </div>
        )}
        <div className={styles.dangerRow}>
          <div>
            <Text variant="md">Delete this project</Text>
            <Text variant="sm">
              Permanent. Only possible once the project has no runs (deleted runs included).
            </Text>
          </div>
          <div className={styles.dangerAction}>
            {blocker && (
              <span
                className={styles.blocker}
                id="delete-blocker"
                title={preview.data?.blocked_reason ?? undefined}
              >
                <Icon name="lock" size={14} />
                {blocker}
              </span>
            )}
            <Button
              variant="danger"
              size="md"
              isDisabled={Boolean(blocker)}
              aria-describedby={blocker ? 'delete-blocker' : undefined}
              onPress={() => setDel(true)}
            >
              Delete
            </Button>
          </div>
        </div>
      </SettingsCard>
      <ArchiveProjectDialog project={project} open={archive} onOpenChange={setArchive} />
      <UnarchiveProjectDialog project={project} open={unarchive} onOpenChange={setUnarchive} />
      <DeleteProjectDialog
        project={project}
        open={del}
        onOpenChange={setDel}
        onArchiveInstead={() => setArchive(true)}
      />
    </Stack>
  );
}
