import type { ReactNode } from 'react';
import { useAnalysisConfig, type AnalysisScope } from '@/api/analysis';
import { PageHeader, TabPanel, Tabs } from '@/ui';
import { fullWidth } from '@/features/shell/layout';
import type { AnalyzerScope } from './useAnalyzerRoute';
import s from './analyzer.module.css';

/**
 * Page chrome shared by the run workspace and the project landing: title, one-line description
 * and ONE tab row (Analyze run, Diagnosis categories, Production rules, Documents). A live
 * analysis puts a dot on "Analyze run" so it stays visible from every tab.
 */
export function AnalyzerFrame({
  slug,
  scope,
  tab,
  onTab,
  description,
  meta,
  live,
  children,
}: {
  slug: string;
  scope: AnalysisScope;
  tab: AnalyzerScope;
  onTab: (tab: AnalyzerScope) => void;
  description: string;
  meta?: string[];
  live?: boolean;
  children: ReactNode;
}) {
  const config = useAnalysisConfig(scope);
  const c = config.data;
  return (
    <div className={`${fullWidth} ${s.page}`}>
      <PageHeader
        title="Auto-analysis"
        description={description}
        meta={[`Project ${slug}`, ...(meta ?? [])]}
        tabs={
          <Tabs
            label="Auto-analysis views"
            selected={tab}
            onSelect={(id) => onTab(id as AnalyzerScope)}
            items={[
              {
                id: 'run',
                label: (
                  <>
                    Analyze run
                    {live ? (
                      <span role="img" aria-label="Analysis running" className={s.liveDot} />
                    ) : null}
                  </>
                ),
              },
              {
                id: 'categories',
                label: 'Diagnosis categories',
                count: c ? (c.category_catalog?.categories ?? c.default_categories).length : undefined,
              },
              { id: 'rules', label: 'Production rules' },
              { id: 'documents', label: 'Documents', count: c?.enabled_document_count },
            ]}
          >
            {/* The view itself is the panel's content; an empty panel keeps aria-controls resolvable. */}
            {(['run', 'categories', 'rules', 'documents'] as const).map((id) => (
              <TabPanel key={id} id={id} className={s.tabPanel} forceMount>
                {null}
              </TabPanel>
            ))}
          </Tabs>
        }
      />
      {children}
    </div>
  );
}
