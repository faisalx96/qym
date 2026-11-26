import { useState } from 'react';
import type { PerformanceSetupTarget, PerformanceTarget } from '@/api/performance';
import { isPlatformTarget, type PlatformTarget } from '@/api/performancePlatform';
import { Button, Card, Dialog } from '@/ui';
import { TargetDialog, type TargetForm } from '../new/TargetDialog';
import { PlatformTargetDialog } from './PlatformTargetDialog';
import styles from './platform.module.css';

type Target = PerformanceSetupTarget | PlatformTarget;
type Props = {
  legacyChatOnly?: boolean;
  slug: string;
  open?: boolean;
  initialForm?: Partial<TargetForm>;
  target?: Target | null;
  targets?: Target[];
  maxUsersLimit?: number;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSaved?: (target: PerformanceTarget | PlatformTarget) => void;
};
export function TargetKindDialog(props: Props) {
  if (props.open === false) return null;
  return (
    <KindBody
      {...props}
      onClose={() => {
        props.onClose?.();
        props.onOpenChange?.(false);
      }}
    />
  );
}
function KindBody(props: Props & { onClose: () => void }) {
  const [kind, setKind] = useState<'chat' | 'estishraf_platform' | null>(
    props.target
      ? isPlatformTarget(props.target)
        ? 'estishraf_platform'
        : 'chat'
      : props.legacyChatOnly
        ? 'chat'
        : null,
  );
  if (kind === 'estishraf_platform')
    return (
      <PlatformTargetDialog
        slug={props.slug}
        target={props.target && isPlatformTarget(props.target) ? props.target : null}
        onClose={props.onClose}
        onSaved={props.onSaved}
        maxUsersLimit={props.maxUsersLimit}
        onChangeKind={() => setKind(null)}
      />
    );
  if (kind === 'chat')
    return (
      <TargetDialog
        slug={props.slug}
        initialForm={props.initialForm}
        open
        target={props.target && !isPlatformTarget(props.target) ? props.target : null}
        targets={props.targets}
        maxUsersLimit={props.maxUsersLimit}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        onSaved={props.onSaved}
      />
    );
  return (
    <Dialog
      open
      title="What do you want to test?"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      footer={<Button onPress={props.onClose}>Cancel</Button>}
    >
      <div className={styles.stack}>
        <p className={styles.note}>Choose the kind of target to add.</p>
        <div className={styles.choices}>
          <Card onPress={() => setKind('chat')}>
            <div className={styles.stack}>
              <strong>Insightor chat</strong>
              <span>Send messages and measure responses.</span>
            </div>
          </Card>
          <Card onPress={() => setKind('estishraf_platform')}>
            <div className={styles.stack}>
              <strong>Estishraf platform</strong>
              <span>Open dashboards and change their filters.</span>
            </div>
          </Card>
        </div>
      </div>
    </Dialog>
  );
}
