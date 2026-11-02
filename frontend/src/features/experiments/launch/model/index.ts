/**
 * Launch-form MODEL LAYER: UI-agnostic, pure TypeScript, no React, no network. Every
 * function takes data in and returns new data (documents are never mutated), so React
 * components only render what these return and call these to change it. Do not
 * re-implement any of this logic in components.
 *
 * ── The pieces ────────────────────────────────────────────────────────────────
 * LaunchDocument (types.ts)  everything the user edited, plain serialisable data; keep
 *                            it in a reducer/useState and replace it with each result.
 * FormContext                what the loaded environments say: `buildContext({ envs,
 *                            extraEndpoints: doc.extraEndpoints, datasetNames,
 *                            evaluatorPanel, maxJobs, isManager })`. `envs` are
 *                            `envDataFrom({ id, name, form, slots, options, … })` of the
 *                            GET …/form, …/model-slots, …/model-options responses. Rebuild
 *                            the context whenever any of them (or doc.extraEndpoints)
 *                            changes. `ctx.union` (merged descriptor) and `ctx.slots`
 *                            (merged confirmed slots + this-experiment endpoints) are
 *                            derived there.
 * SecretStore (secrets.ts)   temporary-model API keys. Create ONE per form in a useRef,
 *                            `put(key)` returns the ref to store in a binding
 *                            (`secretRef`), `clear()` on unmount and after launch. It is
 *                            never part of the document; JSON.stringify(store) is {}.
 *
 * ── Typical flows ─────────────────────────────────────────────────────────────
 * Environments loaded      doc = pruneBindings(pruneOrphanValues(doc, ctx), ctx);
 *                          doc = deriveGlobalModel(doc, ctx); doc = normalizePriority(doc, ctx)
 * Choose a starting point  loaded = loadedBaseFromPreset | loadedBaseFromBestRun |
 *                          loadedBaseFromClone | scratchBase | pendingBestRunBase |
 *                          failedBase  (fetch ?remap=current / …/base yourself);
 *                          if describeBaseChange(doc, label).needed → confirm first;
 *                          `{ doc, dropped } = applyBase(doc, ctx, loaded, secrets)` replays
 *                          the edits that fit; toast droppedChangesMessage(dropped) if > 0.
 * Clone (?clone=&job=)     `p = prefillFromClone(res, { experimentId, jobId, jobRow })`;
 *                          doc = {...doc, ...p.patch}; load the envs (+ extra endpoints:
 *                          cloneExtraEndpoints); applyBase(doc, ctx, loadedBaseFromClone(
 *                          p.patch.clone, ctx)); p.needsKeyReentry lists the slots whose
 *                          temporary model lost its key (see bindingsNeedingKey).
 * Environment settings     `view = buildSettingsView(doc, ctx, { search, changedOnly,
 *                          groupOpen })` is the whole card as a tree (groups → nodes →
 *                          leaves; visible/open/autoOpened already computed). A control's
 *                          text goes to `setLeafInput(doc, node.entry, node.pointer, text,
 *                          node.edit.fallback !== undefined)`; enum selects pass the
 *                          option index (`enumOptions`), booleans 'true' | 'false' | ''.
 *                          Reset: resetField / resetSlot / resetSettings / resetAll.
 *                          Changed dots: node.changed, bindingChanged, stepChangeCount.
 *                          RHF: `node.fieldName` (pointerToFieldName of node.docPointer);
 *                          schemas: leafSchema(entry), rawInputSchema(entry).
 * Models                   setBinding / setGlobalModel / inheritEverywhere /
 *                          addExtraEndpoints / reenterKey; slotConnections(ctx, slot),
 *                          globalConnections; globalSummary → follows/custom. Before a
 *                          global model, load proposals for rawEndpointNames(doc, ctx).
 * Sweeps                   startSweep/stopSweep/addSweepValues/expandRange/linkAxes/…
 *                          (sweeps.ts); a swept value is `{sweep: [...]}` in doc.values
 *                          or doc.evaluator.config, `{kind:'sweep'}` for models;
 *                          runEstimate(spec, envCount, cap) for the maths.
 * Evaluation inputs        evaluatorFields(doc, ctx), setConfigInput, run_metadata rows
 *                          (addMetaRow/updateMetaRow/removeMetaRow/metadataState).
 * Preview (dry run)        key = dryRunKey(doc, panel) → debounce 600 ms, ignore stale
 *                          responses; body = buildLaunchRequest(doc, secrets, { dryRun:
 *                          true }, panel). Name/priority edits re-run the dry run (run
 *                          names depend on them) but are not `specChanged`.
 * Validation / review      `reviewState({ doc, ctx, preview, previewLoading, previewError,
 *                          launchErrors, launching })` → { status, canLaunch, items, count };
 *                          items are { label: 'Primary model › Model', pointer (secondary),
 *                          message, stepId, groupId, fieldName, where[] } — open stepId,
 *                          open groupId, clear the search, focus fieldName. Server errors:
 *                          mapServerErrors; a failed launch: parseLaunchFailure(status,
 *                          body) → preemption (confirm, resend with acknowledgePreemption)
 *                          | validation (launchErrors) | other.
 * Launch                   buildLaunchRequest(doc, secrets, { dryRun: false,
 *                          acknowledgePreemption }) ; then secrets.clear().
 * Raw JSON                 state = initRawJson(doc, panel); editRawJson; applyRawJson(state,
 *                          doc, ctx, secrets) → { state, doc, applied }; revertRawJson;
 *                          syncRawFromForm after form edits; rawJsonStatus(state) is
 *                          'in-sync' | 'unapplied' | 'errors'. Literal API keys in the text
 *                          are refused.
 *
 * Pointers in a document are relative to env_overrides (`/LLM_OVERRIDES/…`); error and
 * focus pointers are document pointers (`/env_overrides/…`, `/slot_bindings/…`,
 * `/evaluator/…`, or `#name`, `#environments`, `#base`, `#latency`,
 * `#advanced-json`).
 */
export * from './types';
export * from './pointers';
export * from './secrets';
export * from './document';
export * from './datasets';
export * from './descriptor';
export * from './sweeps';
export * from './bindings';
export * from './evaluator';
export * from './layering';
export * from './bestRun';
export * from './settingsTree';
export * from './spec';
export * from './validation';
export * from './rawJson';
export * from './editor';
export * from './listTable';
export * from './latencyGate';
export * from './globalSweep';
