/** Right-hand analytics: recomputed over the filtered items; stacks under the list below 1100 px. */
import { useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('metrics');
  const traced = model.runs.some((r) => r.run.trace_stats?.has_spans);
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
