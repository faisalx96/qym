/** Key re-entry for the global model (the model layer only has the per-slot `reenterKey`). */
import {
  endpointSlots,
  followsGlobal,
  reenterKey,
  temporaryBinding,
  type FormContext,
  type LaunchDocument,
  type SecretStore,
  type SlotBinding,
} from '../model';

/**
 * A key typed for a global temporary model that came without one: the global model and every
 * endpoint that follows it use the same ref (asked once, as `bindingsNeedingKey` expects).
 */
export function reenterGlobalKey(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  ref: string,
): LaunchDocument {
  const g = doc.globalModel;
  if (!g || g.kind !== 'temporary') return doc;
  let next = doc;
  for (const slot of endpointSlots(ctx))
    if (followsGlobal(doc, slot.slot_key)) next = reenterKey(next, slot.slot_key, ref);
  return { ...next, globalModel: { ...g, secretRef: ref, needsKey: false } };
}

/** "gpt-4o prod · gpt-4o" */
export function connectionLabel(conn: { name: string; model: string | null }): string {
  return conn.name + (conn.model ? ' · ' + conn.model : '');
}

/** The result of the "+ Temporary model" form, as a binding. The key goes to the SecretStore only. */
export function bindingFromTemporaryForm(
  values: { label: string; model: string; base_url: string; api_key: string; saveToProject: boolean },
  secrets: SecretStore,
): SlotBinding {
  const secretRef = values.api_key ? secrets.put(values.api_key) : null;
  return temporaryBinding({
    label: values.label,
    model: values.model,
    baseUrl: values.base_url,
    secretRef,
    save: values.saveToProject,
  });
}
