/**
 * The item view of the run page: a wide pane at the side of the items table. Input, then Expected beside Output with
 * their differences marked, then the metrics table, the execution facts, the item metadata and the root causes.
 */
import type { Row } from '../../../types';
import { ExecutionBlock, ExpectedBlock, InputBlock, MetadataBlock, OutputBlock, RootCause } from './blocks';
import { Pane } from './Frame';
import { MetricTable } from './metrics';
import s from './pane.module.css';

export function ItemPane({ openId, rows }: { openId: string; rows: Row[] }) {
  return (
    <Pane
      openId={openId}
      rows={rows}
      id="item"
      width={960}
      multiWidth={1040}
      minWidth={560}
      skeleton={['input', 'pair', 'metrics']}
    >
      {({ row, item, focus, setFocus }) => {
        const pass = item.passes.find((p) => p.pass === focus)!;
        return (
          <>
            <InputBlock item={item} />
            <div className={s.pair}>
              <ExpectedBlock row={row} item={item} pass={pass} fill />
              <OutputBlock row={row} item={item} pass={pass} onFocus={setFocus} fill />
            </div>
            <MetricTable key={row.item_id} row={row} item={item} focus={focus} onFocus={setFocus} />
            <ExecutionBlock item={item} />
            <MetadataBlock item={item} />
            <RootCause row={row} />
          </>
        );
      }}
    </Pane>
  );
}
