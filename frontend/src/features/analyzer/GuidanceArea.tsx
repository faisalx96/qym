import { useAnalysisConfig, type AnalysisScope } from '@/api/analysis';
import { TabPanel, Tabs } from '@/ui';
import { DiagnosisPanel } from './guidance/DiagnosisPanel';
import { DocumentsPanel } from './guidance/DocumentsPanel';
import { RulesPanel } from './guidance/RulesPanel';
import type { AnalyzerScope } from './useAnalyzerRoute';
import s from './analyzer.module.css';

/** Project guidance: Diagnosis categories, Production rules, Documents (apply to the whole project). */
export function GuidanceArea({
  scope,
  slug,
  canManage,
  tab,
  onTab,
}: {
  scope: AnalysisScope;
  slug: string;
  canManage: boolean;
  tab: Exclude<AnalyzerScope, 'run'>;
  onTab: (tab: Exclude<AnalyzerScope, 'run'>) => void;
}) {
  const config = useAnalysisConfig(scope);
  const c = config.data;
  return (
    <Tabs
      label="Project guidance"
      selected={tab}
      onSelect={(id) => onTab(id as Exclude<AnalyzerScope, 'run'>)}
      items={[
        {
          id: 'categories',
          label: 'Diagnosis categories',
          count: c ? (c.category_catalog?.categories ?? c.default_categories).length : undefined,
        },
        { id: 'rules', label: 'Production rules' },
        { id: 'documents', label: 'Documents', count: c?.enabled_document_count },
      ]}
    >
      <TabPanel id="categories">
        <div className={s.pad}>
          <DiagnosisPanel
            scope={scope}
            slug={slug}
            canManage={canManage && (c?.can_manage_category_catalog ?? true)}
          />
        </div>
      </TabPanel>
      <TabPanel id="rules">
        <div className={s.pad}>
          <RulesPanel scope={scope} canManage={canManage} />
        </div>
      </TabPanel>
      <TabPanel id="documents">
        <div className={s.pad}>
          <DocumentsPanel
            scope={scope}
            canManage={canManage && (c?.can_manage_analysis_rules ?? true)}
            uploadLimitBytes={c?.analysis_limits.document_upload_bytes}
          />
        </div>
      </TabPanel>
    </Tabs>
  );
}
