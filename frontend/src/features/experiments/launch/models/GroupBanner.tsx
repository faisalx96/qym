import { Button } from '@/ui';
import { Callout } from '../components/Callout';
import { useLaunch } from '../LaunchContext';
import { useGroupsDialog } from './useGroupsDialog';
import styles from './models.module.css';

/** Environments whose LLM groups are unconfirmed: their LLM fields stay raw inputs. */
export function GroupBanner() {
  const { ctx, canManage } = useLaunch();
  const dialog = useGroupsDialog();
  const pending = ctx.envs.filter((e) => e.needsConfirmation);
  if (!pending.length) return null;
  return (
    <>
      <Callout tone="warning" title="Group LLM settings to pick project models">
        <div className={styles.row}>
          <span>
            On {pending.map((e) => e.name).join(', ')}, LLM fields stay raw inputs under Environment
            configurations until their grouping is confirmed.
          </span>
          <span className={styles.spacer} />
          {canManage
            ? pending.map((e) => (
                <Button key={e.id} variant="neutral" onPress={() => dialog.open(e.id)}>
                  {pending.length > 1 ? `Group LLM settings · ${e.name}` : 'Group LLM settings'}
                </Button>
              ))
            : null}
        </div>
      </Callout>
      {dialog.node}
    </>
  );
}
