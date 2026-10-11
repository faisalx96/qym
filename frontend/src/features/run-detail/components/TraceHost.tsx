/** Opens the trace drawer from ?trace=ITEM[&trace_pass=N]; closing removes the params and the page focus returns to the trigger. */
import { useRunPage } from '../RunContext';
import { TraceDrawer } from './traces/TraceDrawer';

export function TraceHost() {
  const { api, model } = useRunPage();
  const itemId = api.traceParam;
  if (!itemId) return null;
  const pass = api.tracePassParam ?? model.viewPass;
  return (
    <TraceDrawer
      key={`${itemId}:${pass ?? ''}`}
      itemId={itemId}
      pass={pass}
      onClose={() => api.setTraceParam(null)}
    />
  );
}
