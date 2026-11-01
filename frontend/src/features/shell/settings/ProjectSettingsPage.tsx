import { useEffect, useMemo } from 'react';
import { useProjectContext } from '../ProjectContext';
import { useDocumentTitle } from '../hooks';
import { constrained } from '../layout';
import { plural } from '../plural';
import { useSearchParamsState } from '@/lib/url-state';
import { Identicon, PageHeader, StatusMark, TabPanel, Tabs, Tag, Text } from '@/ui';
import { GeneralTab } from './GeneralTab';
import { MembersTab } from './MembersTab';
import { ApiKeysTab } from './ApiKeysTab';
import { LlmConnectionsTab } from './LlmConnectionsTab';
import { EnvironmentsTab } from './EnvironmentsTab';
import { PromptsTab } from './PromptsTab';
import { formatDay } from '@/lib/dates';

export const SETTINGS_TABS = ['general', 'members', 'apikeys', 'llm', 'environments', 'prompts'] as const;
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
      ] as { id: SettingsTab; label: string; count?: number }[],
    [project.member_count, canManage],
  );
  const requested = params.get('tab') as SettingsTab | null;
  const selected: SettingsTab = requested && items.some((i) => i.id === requested) ? requested : 'general';
  useEffect(() => {
    if (!requested || requested === selected) return;
    replaceUrlQuery({ tab: null });
    // The Danger zone is a section of General now (round 11): an old ?tab=danger link lands on it.
    if ((requested as string) === 'danger')
      requestAnimationFrame(() => document.getElementById('danger-zone')?.scrollIntoView({ block: 'start' }));
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
          plural(project.member_count, 'member'),
          plural(project.run_count, 'run'),
          `Created ${formatDay(project.created_at)}`,
          // on/off state: only the exception shows
          ...(readOnly
            ? [
                <StatusMark
                  key="status"
                  tone="warning"
                  shape="pause"
                  label="Archived"
                  data-status="archived"
                />,
              ]
            : []),
        ]}
      />
      {readOnly ? (
        <Text variant="sm" as="p" data-archived-settings-note>
          Settings are read-only while the project is archived.
          {canManage
            ? ' You can still revoke API keys and remove members'
            : ' You can still revoke your own API keys'}
          {isAdmin ? ', and unarchive or delete the project from the Danger zone.' : '.'}
        </Text>
      ) : null}
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
      </Tabs>
    </div>
  );
}
