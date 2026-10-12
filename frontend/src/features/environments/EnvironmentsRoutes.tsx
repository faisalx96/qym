/** Route glue for /projects/:slug/environments/*: list, page, default-preset editor. */
import { useParams } from 'react-router-dom';
import { EnvironmentsPage } from './EnvironmentsPage';
import { EnvironmentPage } from './EnvironmentPage';
import { DefaultPresetEditorPage } from './DefaultPresetEditorPage';

export function EnvironmentsRoute() {
  const parts = (useParams()['*'] ?? '').split('/').filter(Boolean);
  if (parts.length === 0) return <EnvironmentsPage />;
  const envId = decodeURIComponent(parts[0] ?? '');
  if (parts[1] === 'default-preset' && parts[2] === 'edit')
    return <DefaultPresetEditorPage environmentId={envId} />;
  return <EnvironmentPage environmentId={envId} />;
}
