/**
 * The item view of the run page: a wide pane at the side of the items table. Input, Expected and the output each on a
 * row of their own (the output marks its differences from Expected), then the metrics table, the execution facts, the
 * item metadata and the root causes. A multi-pass item shows the passes the reader turns on (up to three) side by
 * side in the Output row: one output, one score column and one root-cause review per pass in view.
 */
import { SectionBoundary } from '@/ui';
import type { Row } from '../../../types';
import { ExecutionBlock, InputBlock, MetadataBlock, ItemTexts, RestrictedNote, RootCause } from './blocks';
import { Pane } from './Frame';
import { MetricTable } from './metrics';

export function ItemPane({ openId, rows }: { openId: string; rows: Row[] }) {
  return (
    <Pane
      openId={openId}
      rows={rows}
      id="item"
      width={960}
      multiWidth={1040}
      minWidth={560}
      skeleton={['input', 'expected', 'outputs', 'metrics']}
    >
      {({ row, item, open, order, setOpen, trace }) => (
        <>
          <RestrictedNote item={item} />
          <InputBlock item={item} />
          <ItemTexts row={row} item={item} open={open} order={order} onPick={setOpen} onTrace={trace} />
          <SectionBoundary name="the metrics">
            <MetricTable key={row.item_id} row={row} item={item} open={open} />
          </SectionBoundary>
          <ExecutionBlock item={item} />
          <MetadataBlock item={item} />
          <RootCause row={row} item={item} open={open} />
        </>
      )}
    </Pane>
  );
}
