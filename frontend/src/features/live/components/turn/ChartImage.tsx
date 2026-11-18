import { useState } from 'react';
import { Dialog, EmptyState } from '@/ui';
import type { ChartEvidence } from '../../lib/summary';
import styles from '../../turn.module.css';

export function ChartImage({ chart }: { chart: ChartEvidence }) {
  const [open, setOpen] = useState(false);
  const { image } = chart;
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
  const sentence = chart.reading?.trim().split(/(?<=[.!?؟])\s+/u)[0];
  const alt = `${chart.kind ?? 'chart'} chart${sentence ? ` — ${sentence}` : ''}`;
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
