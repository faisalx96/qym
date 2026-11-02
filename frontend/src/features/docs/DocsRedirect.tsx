import { Navigate, useLocation } from 'react-router-dom';
import { FIRST_PAGE, docsPath, legacyHashToPath } from './content';

/** `/docs-guide[#section/page[/heading]]` and `/docs` → `/docs/:section/:page#heading` (replace). */
export function DocsRedirect() {
  const { hash } = useLocation();
  const target = legacyHashToPath(hash) ?? docsPath(FIRST_PAGE);
  return <Navigate to={target} replace />;
}
