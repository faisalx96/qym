import { useState } from 'react';
import { useRenameProject, useReviewRules } from '@/api/projects';
import { ApiError } from '@/lib/http';
import { Button, Checkbox, KeyValueGrid, Select, Stack, Text, TextField, useToast } from '@/ui';
import { useProjectContext } from '../ProjectContext';
import styles from './settings.module.css';

export function GeneralTab() {
  const { project, readOnly, canManage, isAdmin } = useProjectContext();
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const rename = useRenameProject(project.id);
  const [approvers, setApprovers] = useState<'members' | 'managers'>(project.correction_approvers);
  const [differentReviewer, setDifferentReviewer] = useState(project.correction_require_different_reviewer);
  const rules = useReviewRules(project.id);

  async function saveName() {
    if (!name.trim() || name.trim() === project.name) return;
    try {
      const updated = await rename.mutateAsync({ name: name.trim() });
      toast.show(`Renamed to ${updated.name}`, { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || 'Could not rename' : 'Could not rename', { tone: 'error' });
    }
  }

  return (
    <Stack gap="lg">
      <section className={styles.card} aria-labelledby="general-overview">
        <div className={styles.cardHeader}>
          <Text variant="md" id="general-overview">
            Overview
          </Text>
        </div>
        <div className={styles.cardBody}>
          <KeyValueGrid
            aria-label="Project overview"
            columns={3}
            items={[
              { key: 'slug', label: 'Slug', value: project.slug, mono: true },
              { key: 'role', label: 'Your role', value: isAdmin ? 'Admin' : project.role || 'Member' },
              { key: 'members', label: 'Members', value: project.member_count },
              { key: 'runs', label: 'Runs', value: project.run_count },
              { key: 'status', label: 'Status', value: project.is_active ? 'Active' : 'Archived' },
              { key: 'created', label: 'Created', value: new Date(project.created_at).toLocaleDateString(), mono: true },
            ]}
          />
        </div>
      </section>

      {isAdmin && !readOnly ? (
        <section className={styles.card} aria-labelledby="general-name">
          <div className={styles.cardHeader}>
            <div>
              <Text variant="md" id="general-name">
                Name
              </Text>
              <Text variant="sm">Shown in the sidebar, breadcrumbs and run pages. The slug does not change.</Text>
            </div>
          </div>
          <div className={styles.cardBody}>
            <form
              className={styles.addBar}
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <TextField label="Project name" hideLabel value={name} onChange={setName} width={320} />
              <Button type="submit" variant="primary" isDisabled={!name.trim() || name.trim() === project.name} loading={rename.isPending}>
                Save
              </Button>
            </form>
          </div>
        </section>
      ) : null}

      {canManage ? (
        <section className={styles.card} aria-labelledby="general-rules">
          <div className={styles.cardHeader}>
            <div>
              <Text variant="md" id="general-rules">
                Correction review rules
              </Text>
              <Text variant="sm">Who may approve corrections and whether the author can review their own.</Text>
            </div>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.formRow}>
              <Select
                label="Approvers"
                items={[
                  { key: 'members', label: 'Any member' },
                  { key: 'managers', label: 'Managers only' },
                ]}
                value={approvers}
                onChange={(k) => setApprovers((k as 'members' | 'managers') ?? 'members')}
                isDisabled={readOnly}
              />
            </div>
            <Checkbox isSelected={differentReviewer} onChange={setDifferentReviewer} isDisabled={readOnly}>
              Require a different reviewer than the author
            </Checkbox>
          </div>
          {!readOnly ? (
            <div className={styles.cardFooter}>
              <Button
                variant="primary"
                loading={rules.isPending}
                isDisabled={approvers === project.correction_approvers && differentReviewer === project.correction_require_different_reviewer}
                onPress={async () => {
                  try {
                    await rules.mutateAsync({ correction_approvers: approvers, correction_require_different_reviewer: differentReviewer });
                    toast.show('Review rules saved', { tone: 'success' });
                  } catch (e) {
                    toast.show(e instanceof ApiError ? e.detail || 'Could not save' : 'Could not save', { tone: 'error' });
                  }
                }}
              >
                Save rules
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </Stack>
  );
}
