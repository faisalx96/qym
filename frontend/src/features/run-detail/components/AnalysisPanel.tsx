/** Sticky analysis side panel (inline ≥1200 px, Drawer below). Every chart in it is a filter source. */
import { Button, Drawer, Icon, IconButton, TabPanel, Tabs, Text, type TabItem } from '@/ui';
import { useReviewHistoryQuery } from '@/api/runs';
import { useRunPage } from '../RunContext';
import { errorBucketCount } from '../lib/panelCounts';
import { CategoriesTab } from './panels/CategoriesTab';
import { DeepTab } from './panels/DeepTab';
import { ErrorsTab } from './panels/ErrorsTab';
import { LatencyTab } from './panels/LatencyTab';
import { OverviewTab } from './panels/OverviewTab';
import { RepeatTab } from './panels/RepeatTab';
import { ReviewsTab } from './panels/ReviewsTab';
import { RootCauseTab } from './panels/RootCauseTab';
import styles from './AnalysisPanel.module.css';

export const PANEL_TABS = [
  'overview',
  'errors',
  'categories',
  'latency',
  'deep',
  'root-cause',
  'repeat',
  'reviews',
] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export interface AnalysisPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  wide: boolean;
}

function PanelContents({
  tab,
  onTab,
  onClose,
  wide,
}: {
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  wide: boolean;
}) {
  const { runId, items, model, payload } = useRunPage();
  const reviews = useReviewHistoryQuery(runId, true);
  const reviewCount = reviews.data?.events.length ?? 0;
  const errorCount = errorBucketCount(model.rows, model.isRepeat && !model.viewPass);
  const entries: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'errors', label: 'Errors', count: errorCount, tone: errorCount ? 'danger' : undefined },
    { id: 'categories', label: 'Categories' },
    { id: 'latency', label: 'Latency' },
    { id: 'deep', label: 'Deep' },
    { id: 'root-cause', label: 'Root cause' },
    ...(model.isRepeat && !model.viewPass ? [{ id: 'repeat', label: 'Repeat' }] : []),
    ...(reviewCount ? [{ id: 'reviews', label: 'Reviews', count: reviewCount }] : []),
  ];
  const current = entries.some((e) => e.id === tab) ? tab : 'overview';
  const body = (id: PanelTab) => {
    if (id !== current) return null;
    switch (id) {
      case 'overview':
        return <OverviewTab />;
      case 'errors':
        return <ErrorsTab />;
      case 'categories':
        return <CategoriesTab />;
      case 'latency':
        return <LatencyTab />;
      case 'deep':
        return <DeepTab />;
      case 'root-cause':
        return <RootCauseTab />;
      case 'repeat':
        return <RepeatTab />;
      case 'reviews':
        return <ReviewsTab />;
    }
  };
  return (
    <>
      <div className={styles.head}>
        <Text as="h2" variant="lg">
          Analysis
        </Text>
        {wide ? <IconButton label="Collapse analysis panel" icon="chevron-right" onPress={onClose} /> : null}
      </div>
      <Text as="p" variant="sm" tone="muted">
        Charts reflect the {items.length.toLocaleString('en-US')} of{' '}
        {payload.snapshot.rows.length.toLocaleString('en-US')} filtered items. Click a mark to filter the
        table.
      </Text>
      <Tabs
        label="Analysis views"
        selected={current}
        onSelect={(id) => onTab(id as PanelTab)}
        items={entries}
      >
        {entries.map((e) => (
          <TabPanel key={e.id} id={e.id} forceMount>
            <div className={styles.body}>{body(e.id as PanelTab)}</div>
          </TabPanel>
        ))}
      </Tabs>
    </>
  );
}

export function AnalysisPanel({ open, onOpenChange, tab, onTab, wide }: AnalysisPanelProps) {
  if (!open) return null;
  if (wide) {
    return (
      <aside id="analysis-panel" className={styles.panel} aria-label="Analysis">
        <PanelContents tab={tab} onTab={onTab} onClose={() => onOpenChange(false)} wide />
      </aside>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Analysis" width={460}>
      <div className={styles.drawerBody}>
        <PanelContents tab={tab} onTab={onTab} onClose={() => onOpenChange(false)} wide={false} />
        <Button
          variant="accent"
          size="sm"
          icon={<Icon name="list" size={12} />}
          onPress={() => onOpenChange(false)}
        >
          See the matching items
        </Button>
      </div>
    </Drawer>
  );
}
