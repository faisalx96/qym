import { Navigate, useLocation, useParams } from 'react-router-dom';
import { projectPath } from '@/app/routes';

/** `/projects/<slug>/runs` is the project's runs list: a trimmed run URL lands there, with its query (C209). */
export function RunsIndexRedirect() {
  const { slug = '' } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${projectPath(slug)}${search}${hash}`} replace />;
}
