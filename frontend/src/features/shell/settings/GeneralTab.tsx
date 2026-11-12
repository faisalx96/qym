import { useState } from 'react';
import { useRenameProject, useReviewRules } from '@/api/projects';
import { actionErrorMessage } from '@/lib/http';
import { useSubmitLock } from '@/lib/pending';
import { Checkbox, Select, Stack, TextField, useToast } from '@/ui';
import { useProjectContext } from '../ProjectContext';
import styles from './settings.module.css';
import { DangerZoneSection } from './DangerZoneSection';
import { SettingsCard } from './SettingsCard';

export function GeneralTab() {
  const { project, readOnly, canManage, isAdmin } = useProjectContext();
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const rename = useRenameProject(project.id);
  const [approvers, setApprovers] = useState<'members' | 'managers'>(project.correction_approvers);
  const [differentReviewer, setDifferentReviewer] = useState(project.correction_require_different_reviewer);
  const rules = useReviewRules(project);
  const lock = useSubmitLock();

  function saveName() {
    if (!name.trim() || name.trim() === project.name) return;
    void lock(async () => {
      try {
        const updated = await rename.mutateAsync({ name: name.trim() });
        toast.show(`Renamed to ${updated.name}`, { tone: 'success' });
      } catch (e) {
        toast.show(actionErrorMessage('rename the project', e), {
          tone: 'error',
        });
      }
    });
  }

  return (
    <Stack gap="lg">
      {isAdmin && !readOnly ? (
        <SettingsCard
          title="Name"
          description="Shown in the sidebar, breadcrumbs and run pages. The slug does not change."
          save={{
            dirty: Boolean(name.trim()) && name.trim() !== project.name,
            saving: rename.isPending,
            onSave: saveName,
          }}
        >
          <form
            className={styles.addBar}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== project.name) saveName();
            }}
          >
            <TextField label="Project name" hideLabel value={name} onChange={setName} width={320} />
          </form>
        </SettingsCard>
      ) : null}

      <SettingsCard
        title="Correction review rules"
        description={`Who may approve corrections and whether the author can review their own.${
          canManage ? '' : ' Only project managers can change these rules.'
        }`}
        save={
          !readOnly && canManage
            ? {
                dirty:
                  approvers !== project.correction_approvers ||
                  differentReviewer !== project.correction_require_different_reviewer,
                saving: rules.isPending,
                onSave: () =>
                  void lock(async () => {
                    try {
                      await rules.mutateAsync({
                        correction_approvers: approvers,
                        correction_require_different_reviewer: differentReviewer,
                      });
                      toast.show('Review rules saved', { tone: 'success' });
                    } catch (e) {
                      toast.show(actionErrorMessage('save the rules', e), {
                        tone: 'error',
                      });
                    }
                  }),
              }
            : undefined
        }
      >
        <div className={styles.formRow}>
          <Select
            label="Approvers"
            items={[
              { key: 'members', label: 'Any member' },
              { key: 'managers', label: 'Managers only' },
            ]}
            value={approvers}
            onChange={(k) => setApprovers((k as 'members' | 'managers') ?? 'members')}
            isDisabled={readOnly || !canManage}
          />
        </div>
        <Checkbox
          isSelected={differentReviewer}
          onChange={setDifferentReviewer}
          isDisabled={readOnly || !canManage}
        >
          Require a different reviewer than the author
        </Checkbox>
      </SettingsCard>
      {isAdmin ? <DangerZoneSection /> : null}
    </Stack>
  );
}
