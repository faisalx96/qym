import { useEffect, useRef, useState } from 'react';
import { TemporaryModelForm } from '@/features/environments/TemporaryModelForm';
import { Button, Select, Tag, Card } from '@/ui';
import { useLaunch } from '../LaunchContext';
import {
  bindingFromSweepItem,
  canEnterKeys,
  endpointSlots,
  globalConnections,
  globalSummary,
  inheritEverywhere,
  rawEndpointNames,
  setGlobalModel,
  startModelSweep,
  type SlotBinding,
  type SweepModelItem,
} from '../model';
import { withPrunedLinks } from '../settings/sweepDoc';
import { bindingFromTemporaryForm, connectionLabel } from './keys';
import { ReenterKeyRow } from './ReenterKeyRow';
import { SweepChips } from './SweepChips';
import { TemporaryChip } from './TemporaryChip';
import styles from './models.module.css';

const NONE = '__none__';
const CURRENT = '__current__';

async function waitUntil(cond: () => boolean, timeout = 1500): Promise<void> {
  const end = Date.now() + timeout;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 16));
}

/** The global model (B22): one model for every LLM endpoint; single endpoints can still differ. */
export function GlobalModelCard() {
  const { doc, ctx, setDoc, secrets, loadProposal, mode } = useLaunch();
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);
  const [formOpen, setFormOpen] = useState(false);
  const slots = endpointSlots(ctx);
  const g = doc.globalModel;
  if (!slots.length) return null;
  const summary = globalSummary(doc, ctx);
  const connections = globalConnections(ctx, slots);
  const keys = canEnterKeys(ctx);

  /** Endpoints that only have raw values get their slots first, then every endpoint takes the model. */
  async function apply(binding: SlotBinding | null) {
    setFormOpen(false);
    if (binding) {
      const raw = rawEndpointNames(doc, ctx);
      if (raw.length) {
        const added = await loadProposal(raw);
        await waitUntil(() =>
          added.every((n) => ctxRef.current.slots.some((s) => s.slot_key === 'endpoint:' + n)),
        );
      }
    }
    setDoc((d) => withPrunedLinks(setGlobalModel(d, ctxRef.current, binding, secrets), ctxRef.current));
  }

  const value = g?.kind === 'connection' ? g.id : g?.kind === 'temporary' ? CURRENT : NONE;
  const items = [
    { key: NONE, label: 'None: pick a model per endpoint' },
    ...connections.map((c) => ({
      key: c.id,
      label: connectionLabel(c),
      description: c.available ? undefined : c.reasons.join('; '),
      disabled: !c.available,
    })),
    ...(g?.kind === 'temporary' ? [{ key: CURRENT, label: 'Temporary: ' + (g.label || g.model) }] : []),
  ];
  const names = (list: typeof slots) => list.map((s) => s.label).join(', ');

  return (
    <Card tone="info" role="group" aria-label="Global model" data-global-model>
      <div className={styles.cardStack}>
        <div className={styles.head}>
          <span className={styles.title}>Global model</span>
          {g ? (
            <Tag kind="count">
              {summary.following.length} of {summary.total} endpoint{summary.total === 1 ? '' : 's'}
            </Tag>
          ) : null}
          <span className={styles.spacer} />
          {g ? (
            <Button variant="ghost" onPress={() => void apply(null)}>
              Clear
            </Button>
          ) : null}
        </div>
        <p className={styles.hint}>
          Sets the model, base URL and API key of every LLM endpoint at once. Roles use the model of the
          endpoint they point at.
        </p>
        {g?.kind === 'sweep' ? (
          <SweepChips
            label="Global model"
            items={g.items}
            connections={connections}
            onChange={(next: SweepModelItem[]) => void apply({ kind: 'sweep', items: next })}
            onSingle={() => {
              const first = bindingFromSweepItem(g.items[0]);
              if (first) void apply(first);
              else
                setDoc((d) => withPrunedLinks(inheritEverywhere(d, ctxRef.current, secrets), ctxRef.current));
            }}
          />
        ) : (
          <>
            <Select
              label="Global model"
              items={items}
              value={value}
              onChange={(key) => {
                if (key === CURRENT) return;
                if (key === NONE || key == null) void apply(null);
                else void apply({ kind: 'connection', id: String(key) });
              }}
              help={
                connections.length
                  ? undefined
                  : 'No project models are available for experiments on every endpoint.'
              }
            />
            {g?.kind === 'temporary' ? (
              <>
                <TemporaryChip binding={g} />
                {!g.secretRef ? <ReenterKeyRow slotKey={null} label="the global model" /> : null}
              </>
            ) : null}
            {formOpen ? (
              <TemporaryModelForm
                keysAllowed={keys.allowed}
                keysReason={keys.reason}
                canSaveToProject={false}
                allowHttp
                onCancel={() => setFormOpen(false)}
                onSubmit={(v) =>
                  void apply(bindingFromTemporaryForm({ ...v, saveToProject: false }, secrets))
                }
              />
            ) : (
              <div className={styles.row}>
                {mode === 'launch' ? (
                  <>
                    <Button variant="neutral" onPress={() => setFormOpen(true)}>
                      + Temporary model
                    </Button>
                    <Button variant="neutral" onPress={() => void apply(startModelSweep(g))}>
                      + models
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          </>
        )}
        {g ? (
          <div>
            <p className={styles.hint} data-global-status>
              {summary.custom.length
                ? `Follows the global model: ${names(summary.following) || 'none'}. Custom: ${names(summary.custom)}.`
                : 'Every endpoint follows the global model.'}
            </p>
            <p className={styles.hint}>
              Changing the global model sets every endpoint again, custom ones too. Clearing it keeps each
              endpoint’s model.
            </p>
            {summary.custom.length ? (
              <div className={styles.row}>
                <Button variant="neutral" onPress={() => void apply(g)}>
                  Apply to all endpoints
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.hint}>
            Pick a model to use it on every endpoint; single endpoints can still be changed below.
          </p>
        )}
      </div>
    </Card>
  );
}
