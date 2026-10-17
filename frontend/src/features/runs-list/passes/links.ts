import { runPath } from '@/app/routes';
import { runHref } from '@/lib/runs-order';

/** Link to one pass of a run (`?pass=n`), optionally to a sub page such as `/analyzer`. */
export function passHref(slug: string, listContext: string, runId: string, n: number, sub = ''): string {
  const base = runHref(`${runPath(slug, runId)}${sub}`, listContext);
  return `${base}${base.includes('?') ? '&' : '?'}pass=${n}`;
}
