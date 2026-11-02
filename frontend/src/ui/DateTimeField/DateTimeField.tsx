import type { KeyboardEvent } from 'react';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
  TimeField,
} from 'react-aria-components';
import { CalendarDateTime, Time, type DateValue } from '@internationalized/date';
import { Icon } from '../Icon';
import styles from './DateTimeField.module.css';

export interface DateTimeFieldProps {
  /** Accessible name (the field shows no visible label). */
  label: string;
  /** A local minute `YYYY-MM-DDTHH:mm`, a local day `YYYY-MM-DD`, or '' for none. */
  value: string;
  /** Always a local minute `YYYY-MM-DDTHH:mm`, or '' when the field is cleared. */
  onChange: (value: string) => void;
  /** The time a day gets when it is picked without one: `start` 00:00 (a From bound), `end` 23:59 (a To bound). */
  dayTime?: 'start' | 'end';
  autoFocus?: boolean;
  /** Enter and Escape on the segments (the field handles its own arrows and digits). */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  width?: number;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function parse(value: string, dayTime: 'start' | 'end'): CalendarDateTime | null {
  const m = LOCAL.exec(value);
  if (!m) return null;
  const end = dayTime === 'end';
  return new CalendarDateTime(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    m[4] ? Number(m[4]) : end ? 23 : 0,
    m[5] ? Number(m[5]) : end ? 59 : 0,
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

function format(v: DateValue | null): string {
  if (!v) return '';
  const t = 'hour' in v ? v : { hour: 0, minute: 0 };
  return `${v.year}-${pad(v.month)}-${pad(v.day)}T${pad(t.hour)}:${pad(t.minute)}`;
}

/**
 * Date and time in one 24px control (round 10, the runs Range): typed segments (date, then a 24-hour time) and a
 * calendar button that opens the qym calendar with a Time field under it. A day picked in the calendar keeps the
 * time already set, else `dayTime`.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  dayTime = 'start',
  autoFocus,
  onKeyDown,
  width = 168,
}: DateTimeFieldProps) {
  const current = parse(value, dayTime);
  const now = new Date();
  const placeholder = new CalendarDateTime(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    dayTime === 'end' ? 23 : 0,
    dayTime === 'end' ? 59 : 0,
  );
  return (
    <DatePicker
      aria-label={label}
      className={styles.picker}
      value={current}
      onChange={(v) => onChange(format(v))}
      granularity="minute"
      hourCycle={24}
      shouldForceLeadingZeros
      placeholderValue={placeholder}
      autoFocus={autoFocus}
      style={{ width }}
    >
      <Group className={styles.field} onKeyDown={onKeyDown}>
        <DateInput className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <AriaButton className={styles.open} aria-label={`Open the calendar for ${label}`}>
          <Icon name="calendar" size={12} />
        </AriaButton>
      </Group>
      <Popover className={styles.popover} placement="bottom start" offset={4}>
        <Dialog className={styles.dialog} aria-label={`${label}: date and time`}>
          <Calendar className={styles.calendar}>
            <header className={styles.head}>
              <AriaButton slot="previous" className={styles.nav} aria-label="Previous month">
                <Icon name="chevron-left" size={12} />
              </AriaButton>
              <Heading className={styles.month} />
              <AriaButton slot="next" className={styles.nav} aria-label="Next month">
                <Icon name="chevron-right" size={12} />
              </AriaButton>
            </header>
            <CalendarGrid className={styles.grid} weekdayStyle="short">
              {(date) => <CalendarCell date={date} className={styles.day} />}
            </CalendarGrid>
          </Calendar>
          <TimeField
            aria-label={`${label}: time`}
            className={styles.time}
            value={current ? new Time(current.hour, current.minute) : null}
            onChange={(t) => {
              if (!t || !current) return;
              onChange(format(current.set({ hour: t.hour, minute: t.minute })));
            }}
            hourCycle={24}
            shouldForceLeadingZeros
            isDisabled={!current}
          >
            <span className={styles.timeLabel}>Time</span>
            <DateInput className={styles.timeInput}>
              {(segment) => <DateSegment segment={segment} className={styles.segment} />}
            </DateInput>
          </TimeField>
        </Dialog>
      </Popover>
    </DatePicker>
  );
}
