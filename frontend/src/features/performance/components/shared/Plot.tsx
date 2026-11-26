/** Performance area: the frame of a chart (drawn at the real width of its box) and the card that holds one. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Card, CardTitle } from '@/ui';
import { ChartTooltipHost } from '@/ui/Chart';
import styles from './shared.module.css';

/** Draws a chart at the real width of its box, so its text keeps the token size at every width. */
export function Plot({
  height,
  label,
  children,
}: {
  height: number;
  /** What the picture shows, in words, for people who cannot see it. */
  label: string;
  children: (width: number) => ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.clientWidth));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <ChartTooltipHost className={styles.chart}>
      <div ref={box} style={{ blockSize: height }} data-performance-chart={label}>
        {width ? (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={label}
            data-marks=""
          >
            {children(width)}
          </svg>
        ) : null}
      </div>
    </ChartTooltipHost>
  );
}

/** A card that holds one chart: the title, its caption directly below, the legend at the end of the title row. */
export function PlotCard({
  title,
  caption,
  legend,
  className,
  children,
}: {
  title: string;
  caption?: ReactNode;
  legend?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card as="section" aria-label={title} className={className} data-performance-plot={title}>
      <div className={styles.stack}>
        <CardTitle title={title} description={caption} aside={legend} />
        {children}
      </div>
    </Card>
  );
}
