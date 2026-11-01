import { useSearchParamsState } from '@/lib/url-state';
import { Button, DateTimeField, IconButton, Popover, Text } from '@/ui';
import { dayLabel, isToday, shiftDay } from '../lib/day';
import styles from '../live.module.css';

export function DaySwitcher({ day }: { day: string }) {
  const { replaceUrlQuery } = useSearchParamsState();
  const today = new Date().toISOString().slice(0, 10);
  const setDay = (value: string) => {
    const key = value.slice(0, 10);
    if (key) replaceUrlQuery({ day: key > today ? today : key });
  };
  return (
    <span className={styles.inline} data-live-block="day-switcher">
      <IconButton label="Previous day" icon="prev" onPress={() => setDay(shiftDay(day, -1))} />
      <Popover label="Choose day" trigger={<Button>{dayLabel(day)}</Button>}>
        <DateTimeField label="Day (UTC)" value={day} onChange={setDay} />
      </Popover>
      <IconButton
        label="Next day"
        icon="next"
        isDisabled={isToday(day) || day > today}
        onPress={() => setDay(shiftDay(day, 1))}
      />
      <Text variant="sm" tone="muted">
        UTC
      </Text>
    </span>
  );
}
