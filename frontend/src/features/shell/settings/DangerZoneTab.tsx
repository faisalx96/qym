import { useState } from 'react';
import { Button, Stack, Text, Card } from '@/ui';
import { useProjectContext } from '../ProjectContext';
import { ArchiveProjectDialog, DeleteProjectDialog, UnarchiveProjectDialog } from '../dialogs';
import styles from './settings.module.css';

export function DangerZoneTab() {
  const { project } = useProjectContext();
  const [archive, setArchive] = useState(false);
  const [unarchive, setUnarchive] = useState(false);
  const [del, setDel] = useState(false);
  return (
    <Stack gap="lg">
      <Card as="section" aria-label="Danger zone" tone="danger" data-danger-zone>
        <div className={styles.cardBody}>
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
            <Button variant="danger" size="md" onPress={() => setDel(true)}>
              Delete
            </Button>
          </div>
        </div>
      </Card>
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
