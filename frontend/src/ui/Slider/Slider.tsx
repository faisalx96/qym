import {
  Label,
  Slider as AriaSlider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  type SliderProps as AriaSliderProps,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import styles from './Slider.module.css';

export interface SliderProps extends Omit<AriaSliderProps<number>, 'className' | 'style' | 'children'> {
  label: string;
  unit?: string;
  className?: string;
  width?: string | number;
  /** 'stacked' (default): label and value above the track. 'inline': label, track, value on one 24px line (toolbars). */
  layout?: 'stacked' | 'inline';
  /** Inline only: a fixed track length, so a long label does not shrink the track and the track never fills a row. */
  trackWidth?: string | number;
}

export function Slider({ label, unit, className, width, layout = 'stacked', trackWidth, ...rest }: SliderProps) {
  const track = typeof trackWidth === 'number' ? `${trackWidth}px` : trackWidth;
  return (
    <AriaSlider
      className={[fieldStyles.field, styles.slider, className].filter(Boolean).join(' ')}
      style={{ width, ...(track ? { ['--slider-track-w' as string]: track } : {}) }}
      data-layout={layout === 'inline' ? 'inline' : undefined}
      data-track-width={track ? '' : undefined}
      {...rest}
    >
      <div className={styles.head}>
        <Label className={fieldStyles.label}>{label}</Label>
        <SliderOutput className={styles.output}>
          {({ state }) => `${state.getThumbValueLabel(0)}${unit ?? ''}`}
        </SliderOutput>
      </div>
      <SliderTrack className={styles.track}>
        {({ state }) => (
          <>
            <span className={styles.fill} style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
            <SliderThumb className={styles.thumb} aria-label={label} />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
