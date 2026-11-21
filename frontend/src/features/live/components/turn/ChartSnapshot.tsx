import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveChartSnapshot, type LiveChartSnapshot } from '@/api/live';
import { Dialog, ErrorState, Skeleton, Text } from '@/ui';
import { SNAPSHOT_CSP, snapshotDocument, snapshotLayout } from '../../lib/snapshot';
import styles from '../../turn.module.css';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter must match React's declaration
  interface IframeHTMLAttributes<T> {
    /** A policy the browser enforces on the framed document itself (CSP embedded enforcement). */
    csp?: string;
  }
}

/**
 * The stored markup, drawn in a frame that can do nothing: `sandbox=""` gives it no scripts, no same-origin
 * access, no forms, popups or navigation of the page. No network is allowed twice over: by the policy inside
 * the document (lib/snapshot) and by the same policy on the frame's `csp` attribute, which the browser
 * enforces whatever the document says. Both are there from the first load.
 * The frame is inert and takes no pointer events, so nothing inside it can be clicked or focused.
 */
function SnapshotFrame({
  doc,
  snapshot,
  title,
  fit,
}: {
  doc: string;
  snapshot: LiveChartSnapshot;
  title: string;
  fit: 'width' | 'contain';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setAvailable((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { box } = snapshot;
  const layout = snapshotLayout(snapshot, available, fit);
  return (
    <div ref={ref} className={fit === 'contain' ? styles.snapshotContain : styles.snapshotFit}>
      <div
        className={styles.snapshotClip}
        style={
          fit === 'contain'
            ? { width: layout.clip.width, height: layout.clip.height }
            : { aspectRatio: `${box.width} / ${box.height}` }
        }
      >
        <iframe
          // Empty on purpose: every sandbox restriction applies. Never add allow-scripts or allow-same-origin.
          sandbox=""
          csp={SNAPSHOT_CSP}
          srcDoc={doc}
          title={title}
          tabIndex={-1}
          ref={(frame) => frame?.setAttribute('inert', '')}
          className={styles.snapshotFrame}
          style={{
            width: layout.frame.width,
            height: layout.frame.height,
            transform: layout.frame.transform,
            visibility: layout.scale > 0 ? 'visible' : 'hidden',
          }}
        />
      </div>
    </div>
  );
}

/** A chart redrawn from its saved markup; clicking it opens the same enlarge dialog a screenshot has. */
export function ChartSnapshot({ snapshot, alt }: { snapshot: LiveChartSnapshot; alt: string }) {
  const [open, setOpen] = useState(false);
  const { markup, style } = useLiveChartSnapshot(snapshot);
  const { box } = snapshot;
  // Built once per content: the stylesheet alone is a few hundred kilobytes.
  const doc = useMemo(
    () =>
      markup.data === undefined || style.data === undefined
        ? undefined
        : snapshotDocument(markup.data, style.data),
    [markup.data, style.data],
  );
  const failed = markup.isError ? markup : style.isError ? style : null;
  if (failed) {
    return (
      <div data-live-chart-snapshot="error">
        <ErrorState
          compact
          error={failed.error}
          title="Couldn’t load the saved chart"
          onRetry={() => {
            if (markup.isError) void markup.refetch();
            if (style.isError) void style.refetch();
          }}
        />
      </div>
    );
  }
  if (doc === undefined) {
    return (
      <figure className={styles.chartImage} data-live-chart-snapshot="loading">
        <div className={styles.snapshotBox}>
          <div style={{ aspectRatio: `${box.width} / ${box.height}` }}>
            <Skeleton kind="chart" height="100%" reserve label="Loading saved chart" />
          </div>
        </div>
      </figure>
    );
  }
  if (doc === null) {
    return (
      <div data-live-chart-snapshot="error">
        <ErrorState
          compact
          error={new Error('The saved chart is not one chart document.')}
          title="Couldn’t redraw the saved chart"
          message="The saved chart is not in a form that qym can redraw."
        />
      </div>
    );
  }
  const title = `Redrawn ${alt}`;
  return (
    <>
      <figure className={styles.chartImage} data-live-chart-snapshot="ready">
        <div className={styles.snapshotBox}>
          <SnapshotFrame doc={doc} snapshot={snapshot} title={title} fit="width" />
          <button
            type="button"
            className={styles.snapshotButton}
            aria-label={`Enlarge ${alt}`}
            onClick={() => setOpen(true)}
          />
        </div>
        <Text as="figcaption" variant="sm" tone="muted" className={styles.snapshotCaption}>
          Redrawn from the saved chart.
        </Text>
      </figure>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="viewport"
        title={<span dir="auto">{alt}</span>}
        className={styles.chartFull}
      >
        <SnapshotFrame doc={doc} snapshot={snapshot} title={title} fit="contain" />
      </Dialog>
    </>
  );
}
