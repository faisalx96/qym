import { useAnalysisConfig, type AnalysisScope, type RuleVersion } from '@/api/analysis';
import { DiagnosisPanel } from './guidance/DiagnosisPanel';
import { DocumentsPanel } from './guidance/DocumentsPanel';
import { RulesPanel } from './guidance/RulesPanel';
import type { AnalyzerScope } from './useAnalyzerRoute';

/** Project guidance (applies to the whole project): the panel of the selected top-level tab. */
export function GuidanceArea({
  scope,
  slug,
  canManage,
  tab,
  onRuleVersion,
}: {
  scope: AnalysisScope;
  slug: string;
  canManage: boolean;
  tab: Exclude<AnalyzerScope, 'run'>;
  /** The rule version open on the Rules tab (cv5 Z11, for the prompt pane's note). */
  onRuleVersion?: (version: RuleVersion | null) => void;
}) {
  const config = useAnalysisConfig(scope);
  const c = config.data;
  if (tab === 'categories')
    return (
      <DiagnosisPanel
        scope={scope}
        slug={slug}
        canManage={canManage && (c?.can_manage_category_catalog ?? true)}
      />
    );
  if (tab === 'rules') return <RulesPanel scope={scope} canManage={canManage} onOpenVersion={onRuleVersion} />;
  return (
    <DocumentsPanel
      scope={scope}
      canManage={canManage && (c?.can_manage_analysis_rules ?? true)}
      uploadLimitBytes={c?.analysis_limits.document_upload_bytes}
    />
  );
}
