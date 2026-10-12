import { Button, useToast } from '@/ui';
import { Callout } from '../components/Callout';
import { useLaunch } from '../LaunchContext';
import { pointerToFieldName, reuseTemporaryPrompt, slotPointer } from '../model';
import styles from './bestrun.module.css';

/**
 * What the chosen best run needs from you: temporary models it used (their keys are never stored,
 * so they come back unbound) and whether the agent / KB versions moved since it ran. A changed
 * drift is listed by the base status above; this adds the explanation and the unknown case.
 */
export function BestRunNotices() {
  const { doc, ctx, setDoc, secrets, openSection, focusField } = useLaunch();
  const toast = useToast();
  const base = doc.base;
  if (base.kind !== 'best_run' || !base.loaded) return null;
  const prompts = base.prompts ?? [];
  const drift = base.drift;

  function reuse(p: NonNullable<typeof base.prompts>[number]) {
    const result = reuseTemporaryPrompt(doc, ctx, p, secrets);
    if (result.error) {
      toast.show(result.error, { tone: 'error' });
      return;
    }
    setDoc(() => result.doc);
    openSection('models');
    focusField(pointerToFieldName(slotPointer(p.slot_key)), 'models');
  }

  return (
    <>
      {drift?.status === 'changed' ? (
        <p className={styles.hint} data-best-run-drift="changed">
          Launching reproduces the configuration, not the agent or knowledge base it ran against, so scores may
          differ.
        </p>
      ) : null}
      {drift?.status === 'unknown' && base.versioning ? (
        <p className={styles.hint} data-best-run-drift="unknown">
          The environment’s current agent and KB versions are not known yet, so drift since this run cannot be
          checked.
        </p>
      ) : null}
      {prompts.length ? (
        <Callout tone="warning" title="Temporary models were left unbound">
          <div className={styles.notice} data-best-run-prompts>
            <p className={styles.hint}>
              Their API keys are never stored. Pick a project model under Models, or use the temporary model again
              and enter its key.
            </p>
            <ul>
              {prompts.map((p) => {
                const bound = doc.bindings[p.slot_key]?.kind === 'temporary';
                return (
                  <li key={p.slot_key} className={styles.promptRow}>
                    <span className={styles.mono}>{p.slot_key}</span>
                    <span>
                      {p.label || p.model || 'temporary model'}
                      {p.model && p.label && p.label !== p.model ? ` (${p.model})` : ''}
                    </span>
                    <Button variant="ghost" isDisabled={bound} onPress={() => reuse(p)}>
                      {bound ? 'In use' : 'Use it again'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Callout>
      ) : null}
    </>
  );
}
