/** Right-hand analytics: recomputed over the filtered items; stacks under the list below 1100 px. */
import { useState } from 'react';
import { useQueryParam } from '@/lib/url-state';
import { TabPanel, Tabs, Text } from '@/ui';
import { useCompare } from '../../CompareContext';
import { CategoriesTab } from './CategoriesTab';
import { ErrorsTab } from './ErrorsTab';
import { MetricsTab } from './MetricsTab';
import { OverviewTab } from './OverviewTab';
import { RootCauseTab } from './RootCauseTab';
import { StepsTab } from './StepsTab';
import styles from './AnalyticsPanel.module.css';

type Tab = 'metrics' | 'overview' | 'categories' | 'errors' | 'root-cause' | 'steps';

export function AnalyticsPanel() {
  const { items, model } = useCompare();
  // In the URL (`panel=errors`) so it survives a run being removed, which remounts the page body.
  const [urlTab, setUrlTab] = useQueryParam('panel', 'metrics');
  // Local state renders the tab at once; the URL copy is what a remount (or a shared link) restores.
  const [picked, setPicked] = useState<string | null>(null);
  const wanted = picked ?? urlTab;
  const setWanted = (t: string) => {
    setPicked(t);
    setUrlTab(t);
  };
  const traced = model.runs.some((r) => r.run.trace_stats?.has_spans);
  const tab: Tab = (['metrics', 'overview', 'categories', 'errors', 'root-cause', 'steps'] as Tab[]).includes(wanted as Tab) && (wanted !== 'steps' || traced) ? (wanted as Tab) : 'metrics';
  const setTab = (t: Tab) => setWanted(t);
  return (
    <aside className={styles.panel} aria-label="Analytics for the filtered items">
      <Text variant="sm" tone="muted">
        Computed over {items.length} filtered item{items.length === 1 ? '' : 's'}.
      </Text>
      <Tabs
        label="Analytics"
        variant="dense"
        selected={tab}
        onSelect={(id) => setTab(id as Tab)}
        items={[
          { id: 'metrics', label: 'Metrics' },
          { id: 'overview', label: 'Overview' },
          { id: 'categories', label: 'Categories' },
          { id: 'errors', label: 'Errors' },
          { id: 'root-cause', label: 'Root cause' },
          ...(traced ? [{ id: 'steps', label: 'Steps' }] : []),
        ]}
      >
        <TabPanel id="metrics">{tab === 'metrics' ? <MetricsTab /> : null}</TabPanel>
        <TabPanel id="overview">{tab === 'overview' ? <OverviewTab /> : null}</TabPanel>
        <TabPanel id="categories">{tab === 'categories' ? <CategoriesTab /> : null}</TabPanel>
        <TabPanel id="errors">{tab === 'errors' ? <ErrorsTab /> : null}</TabPanel>
        <TabPanel id="root-cause">{tab === 'root-cause' ? <RootCauseTab /> : null}</TabPanel>
        <TabPanel id="steps">{tab === 'steps' ? <StepsTab /> : null}</TabPanel>
      </Tabs>
    </aside>
  );
}
