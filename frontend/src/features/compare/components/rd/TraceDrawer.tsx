/**
 * The trace drawer of the compare page: the run page's drawer, for the run of the column that opened it.
 * One component draws both (`TraceView`), so the two pages cannot differ.
 */
export {
  TraceView as TraceDrawer,
  type TraceViewProps as TraceDrawerProps,
} from '@/features/run-detail/components/traces/TraceDrawer';
