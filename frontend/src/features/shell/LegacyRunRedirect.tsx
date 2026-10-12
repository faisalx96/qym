import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '@/lib/http';
import { KEYS, readLocal } from '@/lib/storage';
import { useDelayedPending } from '@/lib/pending';
import { runPath } from '@/app/routes';
import { ErrorState, Skeleton } from '@/ui';
import { useAuth } from './AuthContext';
import { constrained } from './layout';

/** `?view=compact` answers `{ run, snapshot }`; the project hangs off `run`. */
interface CompactRun {
  run?: { run_id?: string; project?: { slug?: string } | null; project_slug?: string | null } | null;
}

/**
 * /run/:runId[/analyzer] → /projects/:slug/runs/:runId[/analyzer]. The run
 * JSON names its project; the remembered slug is only a fallback guess.
 */
export function LegacyRunRedirect() {
  const params = useParams();
  const location = useLocation();
  const { me } = useAuth();
  const splat = params['*'] ?? '';
  const analyzer = /\/analyzer$/.test(splat);
  const runId = analyzer ? splat.replace(/\/analyzer$/, '') : splat;
  const [state, setState] = useState<{ slug?: string; error?: unknown }>({});
  const pending = useDelayedPending(!state.slug && !state.error);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CompactRun>(`/api/runs/${runId.split('/').map(encodeURIComponent).join('/')}?view=compact`)
      .then((run) => {
        if (cancelled) return;
        const slug =
          run.run?.project?.slug ??
          run.run?.project_slug ??
          readLocal(KEYS.lastProjectSlug) ??
          me.projects[0]?.slug;
        if (slug) setState({ slug });
        else setState({ error: new Error('No project context for this run') });
      })
      .catch((error) => {
        if (cancelled) return;
        const guess = readLocal(KEYS.lastProjectSlug) ?? me.projects[0]?.slug;
        if (guess) setState({ slug: guess });
        else setState({ error });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, me.projects]);

  if (state.slug) {
    const target =
      runPath(state.slug, runId) + (analyzer ? '/analyzer' : '') + location.search + location.hash;
    return <Navigate to={target} replace />;
  }
  if (state.error) {
    return (
      <div className={constrained}>
        <ErrorState error={state.error} title="Couldn’t open this run" />
      </div>
    );
  }
  return pending ? (
    <div className={constrained}>
      <Skeleton kind="lines" rows={3} label="Resolving run" />
    </div>
  ) : null;
}
