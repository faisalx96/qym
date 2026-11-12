import { useState } from 'react';
import { useSearchParamsState } from '@/lib/url-state';
import { Button, DateTimeField, IconButton } from '@/ui';
import { dayLabel, isToday, shiftDay } from '../lib/day';
import styles from '../live.module.css';

export function DaySwitcher({ day, today }: { day: string; today: string }) {
  const { replaceUrlQuery } = useSearchParamsState();
  const [open, setOpen] = useState(false);
  const setDay = (value: string) => {
    const key = value.slice(0, 10);
    if (key) replaceUrlQuery({ day: key > today ? today : key });
  };
  return (
    <span className={styles.inline} data-live-block="day-switcher">
      <IconButton label="Previous day" icon="prev" onPress={() => setDay(shiftDay(day, -1))} />
      <Button aria-expanded={open} onPress={() => setOpen((o) => !o)}>
        {dayLabel(day, today)}
      </Button>
      <IconButton
        label="Next day"
        icon="next"
        isDisabled={isToday(day, today) || day > today}
        onPress={() => setDay(shiftDay(day, 1))}
      />
      {open ? (
        <DateTimeField
          label="Day"
          value={day}
          onChange={(v) => {
            setDay(v);
            setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}
