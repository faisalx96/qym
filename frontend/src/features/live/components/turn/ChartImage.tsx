import { useState } from 'react';
import { plural } from '@/features/shell/plural';
import { Dialog, EmptyState } from '@/ui';
import type { ChartEvidence } from '../../lib/summary';
import styles from '../../turn.module.css';
import { ChartSnapshot } from './ChartSnapshot';

/** One chart's evidence, in this order: its snapshot, else its screenshot, else why there is none. */
export function ChartImage({ chart }: { chart: ChartEvidence }) {
  const [open, setOpen] = useState(false);
  const { image } = chart;
  const sentence = chart.reading?.trim().split(/(?<=[.!?؟])\s+/u)[0];
  const alt = `${chart.kind ?? 'chart'} chart${sentence ? ` — ${sentence}` : ''}`;
  if (chart.snapshot) return <ChartSnapshot snapshot={chart.snapshot} alt={alt} />;
  if (!image && chart.imageExpiredAfterDays !== null) {
    return (
      <div data-live-chart-expired>
        <EmptyState
          compact
          title="The screenshot is no longer stored"
          body={`Screenshots are removed ${plural(chart.imageExpiredAfterDays, 'day')} after upload. The scores and the text read from the chart are kept.`}
        />
      </div>
    );
  }
  if (!image) {
    return (
      <div data-live-chart-missing>
        <EmptyState
          compact
          title="No screenshot was captured"
          body="The chart could not be checked by eye. The fidelity score compares the chart's data with the SQL result only."
        />
      </div>
    );
  }
  return (
    <>
      <figure className={styles.chartImage} data-live-chart-image>
        <button
          type="button"
          className={styles.chartButton}
          aria-label={`Enlarge ${alt}`}
          onClick={() => setOpen(true)}
        >
          <img
            src={image.url}
            width={image.width}
            height={image.height}
            alt={alt}
            loading="lazy"
            decoding="async"
          />
        </button>
      </figure>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="viewport"
        title={<span dir="auto">{alt}</span>}
        className={styles.chartFull}
      >
        <img src={image.url} width={image.width} height={image.height} alt={alt} decoding="async" />
      </Dialog>
    </>
  );
}
