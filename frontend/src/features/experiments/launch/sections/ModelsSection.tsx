import { Skeleton } from '@/ui';
import { Callout } from '../components/Callout';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { EndpointControls } from '../models/EndpointControls';
import { GlobalModelCard } from '../models/GlobalModelCard';
import { GroupBanner } from '../models/GroupBanner';
import { SlotCard } from '../models/SlotCard';
import styles from '../models/models.module.css';

/**
 * Models: the group-settings banner, the global model and one
 * card per confirmed model slot (Follow global / Custom / Temporary, sweeps, re-entered keys).
 */
export function ModelsSection() {
  const { ctx, doc, flags } = useLaunch();
  const selected = doc.environmentIds.length > 0;
  return (
    <LaunchSection id="models" description="Pick one model for every LLM endpoint, or a model per endpoint.">
      <div className={styles.stack}>
        <GroupBanner />
        {!selected ? (
          <p className={styles.hint}>Pick an environment to see its model slots.</p>
        ) : flags.envsLoading ? (
          <Skeleton kind="cards" count={2} label="Loading model slots" />
        ) : (
          <>
            {ctx.envs.map((e) =>
              e.optionsError || e.formError ? (
                <Callout key={e.id} tone="error" live>
                  {e.optionsError || e.formError} ({e.name})
                </Callout>
              ) : null,
            )}
            {ctx.slots.length ? (
              <>
                <GlobalModelCard />
                {ctx.slots.map((slot) => (
                  <SlotCard key={slot.slot_key} slot={slot} />
                ))}
              </>
            ) : (
              <p className={styles.hint}>
                No confirmed model slots. LLM fields are edited under Environment configurations.
              </p>
            )}
            <EndpointControls />
          </>
        )}
      </div>
    </LaunchSection>
  );
}
