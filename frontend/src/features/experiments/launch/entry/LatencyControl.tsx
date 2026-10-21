import { useEffect, useMemo } from 'react';
import { Checkbox } from '@/ui';
import { latencyGate, PSEUDO, pointerToFieldName } from '../model';
import {
  LATENCY_CALLOUT_TITLE,
  LATENCY_HELPER,
  LATENCY_LABEL,
  latencyCalloutBody,
} from '../copy';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import styles from './entry.module.css';

/**
 * The Latency-sensitive checkbox, its helper, the gate reason and the warning callout. One value
 * (`doc.latencySensitive`), rendered by the home view and by Customize step 1 (never both at once,
 * so the ids and the registered field are unique).
 */
export function LatencyControl() {
  const { doc, setDoc, ctx, registerField, readOnly } = useLaunch();
  const gate = useMemo(
    () => latencyGate(ctx.envs, ctx.isManager, doc.environmentIds),
    [ctx.envs, ctx.isManager, doc.environmentIds],
  );
  // A box that becomes disabled is cleared at that moment (B5-28).
  useEffect(() => {
    if (gate.disabled && doc.latencySensitive) setDoc((d) => ({ ...d, latencySensitive: false }));
  }, [gate.disabled, doc.latencySensitive, setDoc]);
  const partial = doc.latencySensitive && !gate.disabled && gate.managerOnly.length > 0;
  return (
    <div
      className={styles.latency}
      data-testid="launch-latency"
      ref={(el) => registerField(pointerToFieldName(PSEUDO.latency), el)}
    >
      <Checkbox
        isSelected={doc.latencySensitive}
        isDisabled={readOnly || gate.disabled}
        aria-describedby={`launch-latency-help${gate.reason && !readOnly ? ' launch-latency-reason' : ''}`}
        onChange={(on) => setDoc((d) => ({ ...d, latencySensitive: on }))}
      >
        {LATENCY_LABEL}
      </Checkbox>
      <p className={styles.checkHelp} id="launch-latency-help">
        {LATENCY_HELPER}
      </p>
      {gate.reason && !readOnly ? (
        <p className={styles.checkReason} id="launch-latency-reason" data-testid="launch-latency-reason">
          {gate.reason}
        </p>
      ) : null}
      {doc.latencySensitive ? (
        <Callout tone="warning" title={LATENCY_CALLOUT_TITLE} className={styles.latencyCallout}>
          {partial ? <span>{latencyCalloutBody(gate.managerOnly)}</span> : null}
        </Callout>
      ) : null}
    </div>
  );
}
