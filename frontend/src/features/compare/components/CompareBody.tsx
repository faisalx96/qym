/** Compare report body: the stacked sections. The Quick-filters sidebar lives beside the items list only (owner decision H2). */
import { CompareReport } from './ReportSections';

export const WIDE_QUERY = '(min-width: 1200px)';

export function CompareBody() {
  return <CompareReport />;
}
