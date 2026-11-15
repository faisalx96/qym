import { StateTag } from '@/ui';
import { environmentTone } from '../lib/environment';

/**
 * The environment of a live source (cv5 M2): a state tag in the environment's own tone (production green, a staging or
 * other pre-production environment blue, an unknown name neutral). One look on every Live page that names it.
 */
export function EnvironmentTag({ environment }: { environment: string }) {
  return (
    <StateTag
      tone={environmentTone(environment)}
      dir="auto"
      title={`Environment: ${environment}`}
      data-testid="live-environment"
    >
      {environment}
    </StateTag>
  );
}
