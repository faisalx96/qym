/**
 * Performance pages: the area is switched off on this platform. Every read answers the same 404 then, so the
 * Home, Runner and Targets pages show this plain state instead of an error with Retry.
 */
import { Card, EmptyState } from '@/ui';

export function SwitchedOff() {
  return (
    <Card data-performance-block="switched-off">
      <EmptyState
        title="Performance tests are switched off"
        body="An operator has switched this area off on the platform. Runs, targets and reports are kept and show again when it is switched back on."
      />
    </Card>
  );
}
