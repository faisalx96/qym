import { useLiveTurn } from '@/api/live';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ErrorState, Skeleton, TabPanel, Tabs } from '@/ui';
import { AnswerSqlTab } from './components/turn/AnswerSqlTab';
import { ChartsTab } from './components/turn/ChartsTab';
import { ConversationTab } from './components/turn/ConversationTab';
import { DiagnosisTab } from './components/turn/DiagnosisTab';
import { EvaluatorTab } from './components/turn/EvaluatorTab';
import { JudgesTab } from './components/turn/JudgesTab';
import { ServicesTab } from './components/turn/ServicesTab';
import { TurnHeader } from './components/turn/TurnHeader';
import { TurnTiles } from './components/turn/TurnTiles';
import styles from './turn.module.css';

const tabs = [
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'answer', label: 'Answer and SQL' },
  { id: 'judges', label: 'Judges' },
  { id: 'charts', label: 'Charts' },
  { id: 'services', label: 'Services and tools' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'evaluator', label: 'Evaluator' },
];

export function LiveTurnPage({ slug, source, turnId }: { slug: string; source: string; turnId: string }) {
  const query = useLiveTurn(slug, turnId, source);
  const { get, replaceUrlQuery } = useSearchParamsState();
  const selected = get('tab', 'diagnosis');
  const tab = tabs.some((item) => item.id === selected) ? selected : 'diagnosis';
  const showSkeleton = useDelayedPending(query.isPending);
  useDocumentTitle(`${query.data?.turn.question ?? 'Turn'} · Live`);
  const data = query.data;
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load this turn"
          notFoundMessage="This turn is not in qym"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.isPending ? (
        <div className={styles.loading} data-visible={showSkeleton ? 'true' : 'false'} aria-busy="true">
          <Skeleton kind="chart" height="var(--turn-header-height)" label="Loading turn header" />
          <Skeleton kind="chart" height="var(--turn-tiles-height)" label="Loading turn numbers" />
          <Skeleton kind="chart" height="var(--tab-height)" label="Loading turn sections" />
          <div className={styles.twoColumns}>
            <Skeleton kind="chart" height="var(--turn-why-height)" label="Loading diagnosis" />
            <Skeleton kind="chart" height="var(--turn-deviations-height)" label="Loading judge deviations" />
          </div>
          <div className={styles.twoColumns}>
            <Skeleton kind="chart" height="var(--turn-agent-sql-height)" label="Loading agent SQL" />
            <Skeleton kind="chart" height="var(--turn-judge-sql-height)" label="Loading judge SQL" />
          </div>
          <div className={styles.threeColumns}>
            <Skeleton kind="chart" height="var(--turn-answer-height)" label="Loading answer" />
            <Skeleton kind="chart" height="var(--turn-chart-height)" label="Loading charts" />
            <Skeleton kind="chart" height="var(--turn-services-height)" label="Loading services" />
          </div>
        </div>
      ) : data ? (
        <>
          <TurnHeader data={data} slug={slug} source={source} />
          <TurnTiles data={data} />
          <div data-live-block="tabs">
            <Tabs
              label="Turn sections"
              items={tabs}
              selected={tab}
              onSelect={(next) => replaceUrlQuery({ tab: next === 'diagnosis' ? null : next })}
            >
              <TabPanel id="diagnosis" className={styles.panel}>
                <DiagnosisTab data={data} />
              </TabPanel>
              <TabPanel id="answer" className={styles.panel}>
                <AnswerSqlTab data={data} />
              </TabPanel>
              <TabPanel id="judges" className={styles.panel}>
                <JudgesTab data={data} />
              </TabPanel>
              <TabPanel id="charts" className={styles.panel}>
                <ChartsTab data={data} />
              </TabPanel>
              <TabPanel id="services" className={styles.panel}>
                <ServicesTab data={data} />
              </TabPanel>
              <TabPanel id="conversation" className={styles.panel}>
                <ConversationTab data={data} slug={slug} source={source} />
              </TabPanel>
              <TabPanel id="evaluator" className={styles.panel}>
                <EvaluatorTab data={data} />
              </TabPanel>
            </Tabs>
          </div>
        </>
      ) : null}
    </div>
  );
}
