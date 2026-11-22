import { useQueryClient } from '@tanstack/react-query';
import { useModelIndex } from '@/api/dashboard';
import { useLiveTurn, type LiveTurnsPage } from '@/api/live';
import { projectPath } from '@/app/routes';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { Card, ErrorState, Skeleton, StatStrip, TabPanel, Tabs } from '@/ui';
import { AnswerSqlTab } from './components/turn/AnswerSqlTab';
import { ChartsTab } from './components/turn/ChartsTab';
import { ConversationTab } from './components/turn/ConversationTab';
import { DiagnosisTab } from './components/turn/DiagnosisTab';
import { DiagnosisVerdict } from './components/turn/DiagnosisVerdict';
import { EvaluatorTab } from './components/turn/EvaluatorTab';
import { EvidenceCard } from './components/turn/Evidence';
import { JudgesTab } from './components/turn/JudgesTab';
import { JudgesLoading } from './components/turn/JudgesLoading';
import {
  ReevaluateButton,
  ReevaluationBlock,
  previousVerdictOf,
  useReevaluation,
} from './components/turn/Reevaluation';
import { ServicesTab } from './components/turn/ServicesTab';
import { TurnHeader } from './components/turn/TurnHeader';
import { TurnTiles } from './components/turn/TurnTiles';
import { ExplanationLanguageProvider } from './ExplanationLanguage';
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
  const queryClient = useQueryClient();
  const query = useLiveTurn(slug, turnId, source);
  const modelIndex = useModelIndex(slug);
  const { get, replaceUrlQuery } = useSearchParamsState();
  const selected = get('tab', 'diagnosis');
  const tab = tabs.some((item) => item.id === selected) ? selected : 'diagnosis';
  const showSkeleton = useDelayedPending(query.isPending);
  useDocumentTitle(`${query.data?.turn.question ?? 'Turn'} · Live`);
  const data = query.data;
  const reevaluation = useReevaluation(slug, source, turnId, data, query.dataUpdatedAt);
  const chartSlots =
    query.isPending && tab === 'charts'
      ? (queryClient
          .getQueriesData<LiveTurnsPage>({ queryKey: ['project', slug, 'live', 'turns', source] })
          .flatMap(([, page]) => page?.rows ?? [])
          .find((row) => row.turn_id === turnId)?.charts.count ?? 1)
      : 0;
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load this turn"
          notFoundMessage="This turn is not in qym"
          parent={{
            to: `${projectPath(slug, 'live/turns')}?source=${encodeURIComponent(source)}`,
            label: 'Turns',
          }}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.isPending ? (
        <div className={styles.loading} data-visible={showSkeleton ? 'true' : 'false'} aria-busy="true">
          <Skeleton kind="chart" height="var(--turn-header-height)" label="Loading turn header" />
          <Card compact>
            <Skeleton kind="lines" rows={2} label="Loading verdict reason" />
          </Card>
          <StatStrip
            variant="compact"
            aria-label="Loading turn numbers"
            items={['Agent success', 'Compliance A', 'Compliance B', 'Latency', 'Result rows', 'Charts'].map(
              (label) => ({
                key: label,
                label,
                value: <Skeleton kind="value" width="3ch" label={`Loading ${label.toLowerCase()}`} />,
              }),
            )}
          />
          <Skeleton kind="chart" height="var(--tab-height)" label="Loading turn sections" />
          {tab === 'charts' ? (
            <div className={styles.panel} data-live-block="charts-loading" data-chart-slots={chartSlots}>
              <div className={styles.stack}>
                {Array.from({ length: chartSlots }, (_, index) => (
                  <EvidenceCard key={index} title={`Chart ${index + 1}`}>
                    <div className={styles.loadingChart}>
                      <Skeleton kind="chart" height="100%" label={`Loading chart screenshot ${index + 1}`} />
                    </div>
                    <Skeleton kind="lines" rows={3} label={`Loading chart evidence ${index + 1}`} />
                  </EvidenceCard>
                ))}
              </div>
            </div>
          ) : tab === 'judges' ? (
            <JudgesLoading />
          ) : tab === 'diagnosis' ? (
            <div className={styles.panel}>
              <EvidenceCard title="How we got here">
                <Skeleton kind="lines" rows={6} label="Loading how we got here" />
              </EvidenceCard>
              <EvidenceCard title="Insightor rules behind this verdict">
                <Skeleton kind="lines" rows={1} label="Loading Insightor rules" />
              </EvidenceCard>
              <EvidenceCard title="What Insightor did">
                <Skeleton kind="lines" rows={4} label="Loading turn facts" />
              </EvidenceCard>
            </div>
          ) : (
            <div className={styles.panel}>
              {(tab === 'conversation'
                ? [['Turns in this conversation', 6]]
                : tab === 'evaluator'
                  ? [
                      ['How this turn was evaluated', 8],
                      ['Scores', 8],
                      ['Problems during evaluation', 2],
                      ['Raw evaluation detail', 1],
                    ]
                  : tab === 'services'
                    ? [
                        ['Services', 8],
                        ['Tool calls', 6],
                      ]
                    : [
                        ['Final answer', 5],
                        ['SQL comparison', 12],
                      ]
              ).map(([title, rows]) => (
                <EvidenceCard key={title} title={String(title)}>
                  <Skeleton
                    kind="lines"
                    rows={Number(rows)}
                    label={`Loading ${String(title).toLowerCase()}`}
                  />
                </EvidenceCard>
              ))}
            </div>
          )}
        </div>
      ) : data ? (
        <ExplanationLanguageProvider>
          <TurnHeader
            data={data}
            slug={slug}
            source={source}
            actions={<ReevaluateButton state={reevaluation} />}
          />
          <ReevaluationBlock state={reevaluation} data={data} />
          <DiagnosisVerdict
            data={data}
            reevaluating={Boolean(reevaluation.active)}
            previous={previousVerdictOf(data)}
          />
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
                <AnswerSqlTab data={data} modelIndex={modelIndex} />
              </TabPanel>
              <TabPanel id="judges" className={styles.panel}>
                <JudgesTab data={data} modelIndex={modelIndex} />
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
                <EvaluatorTab data={data} modelIndex={modelIndex} />
              </TabPanel>
            </Tabs>
          </div>
        </ExplanationLanguageProvider>
      ) : null}
    </div>
  );
}
