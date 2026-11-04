import { useState } from 'react';
import { Dialog } from '@/ui';
import type { ChartEvidence } from '../../lib/summary';
import styles from '../../turn.module.css';

export function ChartImage({ chart, size }: { chart: ChartEvidence; size: 'card' | 'thumb' }) {
  const [open, setOpen] = useState(false);
  const { image } = chart;
  if (!image) {
    return (
      <div className={styles.chartMissing} data-live-chart-missing>
        No screenshot was captured for this chart
      </div>
    );
  }
  const sentence = chart.reading?.trim().split(/(?<=[.!?؟])\s+/u)[0];
  const alt = `${chart.kind ?? 'chart'} chart${sentence ? ` — ${sentence}` : ''}`;
  return (
    <>
      <figure
        className={`${styles.chartImage} ${size === 'thumb' ? styles.chartThumb : ''}`}
        data-live-chart-image
      >
        <button type="button" className={styles.chartButton} onClick={() => setOpen(true)}>
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
        size="lg"
        title={<span dir="auto">{alt}</span>}
        className={styles.chartFull}
      >
        <img src={image.url} width={image.width} height={image.height} alt={alt} decoding="async" />
      </Dialog>
    </>
  );
}
