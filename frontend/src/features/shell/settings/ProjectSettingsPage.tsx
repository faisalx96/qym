import { useEffect, useMemo } from 'react';
import { useProjectContext } from '../ProjectContext';
import { useDocumentTitle } from '../hooks';
import { constrained } from '../layout';
import { useSearchParamsState } from '@/lib/url-state';
import { Badge, Identicon, PageHeader, TabPanel, Tabs, Tag } from '@/ui';
import { GeneralTab } from './GeneralTab';
import { MembersTab } from './MembersTab';
import { ApiKeysTab } from './ApiKeysTab';
import { LlmConnectionsTab } from './LlmConnectionsTab';
import { EnvironmentsTab } from './EnvironmentsTab';
import { PromptsTab } from './PromptsTab';
import { DangerZoneTab } from './DangerZoneTab';

export const SETTINGS_TABS = [
  'general',
  'members',
  'apikeys',
  'llm',
  'environments',
  'prompts',
  'danger',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** /projects/:slug/settings?tab=… — the tab is persistent URL state (brief 01 §9.6). */
export function ProjectSettingsPage() {
  const { project, readOnly, canManage, isAdmin } = useProjectContext();
  const { params, replaceUrlQuery } = useSearchParamsState();
  useDocumentTitle(`${project.name} · Settings`);

  const items = useMemo(
    () =>
      [
        { id: 'general', label: 'General' },
        { id: 'members', label: 'Members', count: project.member_count },
        { id: 'apikeys', label: 'API keys' },
        { id: 'llm', label: 'LLM connections' },
        { id: 'environments', label: 'Environments' },
        ...(canManage ? [{ id: 'prompts', label: 'AI prompts' }] : []),
        ...(isAdmin ? [{ id: 'danger', label: 'Danger zone', tone: 'danger' as const }] : []),
      ] as { id: SettingsTab; label: string; count?: number; tone?: 'danger' }[],
    [project.member_count, canManage, isAdmin],
  );
  const requested = params.get('tab') as SettingsTab | null;
  const selected: SettingsTab = requested && items.some((i) => i.id === requested) ? requested : 'general';
  useEffect(() => {
    if (requested && requested !== selected) replaceUrlQuery({ tab: null });
  }, [requested, selected, replaceUrlQuery]);

  return (
    <div className={constrained} data-settings-page>
      <PageHeader
        leading={<Identicon seed={project.slug} chip />}
        title={project.name}
        description="Project settings"
        meta={[
          <Tag key="slug" kind="data">
            {project.slug}
          </Tag>,
          <Tag key="role" kind="role">
            {isAdmin ? 'admin' : project.role || 'member'}
          </Tag>,
          `${project.member_count} member${project.member_count === 1 ? '' : 's'}`,
          readOnly ? (
            <Badge key="status" tone="warning">
              archived
            </Badge>
          ) : (
            <Badge key="status" tone="success">
              active
            </Badge>
          ),
        ]}
      />
      <Tabs
        label="Settings sections"
        items={items}
        selected={selected}
        onSelect={(id) => replaceUrlQuery({ tab: id === 'general' ? null : id })}
      >
        <TabPanel id="general">
          <GeneralTab />
        </TabPanel>
        <TabPanel id="members">
          <MembersTab />
        </TabPanel>
        <TabPanel id="apikeys">
          <ApiKeysTab />
        </TabPanel>
        <TabPanel id="llm">
          <LlmConnectionsTab />
        </TabPanel>
        <TabPanel id="environments">
          <EnvironmentsTab />
        </TabPanel>
        {canManage ? (
          <TabPanel id="prompts">
            <PromptsTab />
          </TabPanel>
        ) : null}
        {isAdmin ? (
          <TabPanel id="danger">
            <DangerZoneTab />
          </TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
