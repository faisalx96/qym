import { useSearchParamsState } from '@/lib/url-state';
import { Button, DateTimeField, IconButton, Popover, Text } from '@/ui';
import { dayLabel, isToday, shiftDay } from '../lib/day';
import { zoneLabel, zoneToday } from '../lib/zone';
import styles from '../live.module.css';

export function DaySwitcher({ day, zone }: { day: string; zone?: string }) {
  const { replaceUrlQuery } = useSearchParamsState();
  const today = zoneToday(zone);
  const setDay = (value: string) => {
    const key = value.slice(0, 10);
    if (key) replaceUrlQuery({ day: key > today ? today : key });
  };
  return (
    <span className={styles.inline} data-live-block="day-switcher">
      <IconButton label="Previous day" icon="prev" onPress={() => setDay(shiftDay(day, -1))} />
      <Popover label="Choose day" trigger={<Button>{dayLabel(day, zone)}</Button>}>
        <DateTimeField label={`Day (${zoneLabel(zone)})`} value={day} onChange={setDay} />
      </Popover>
      <IconButton
        label="Next day"
        icon="next"
        isDisabled={isToday(day, new Date(), zone) || day > today}
        onPress={() => setDay(shiftDay(day, 1))}
      />
      <Text variant="sm" tone="muted">
        {zoneLabel(zone)}
      </Text>
    </span>
  );
}
