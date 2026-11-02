/** Round 8b section-separation specimens (recipes A and B); the full-page mocks are in docs/internal/ui-migration/redesign8/sections/shots. */
import type { ReactNode } from 'react';
import { SectionHeader } from '@/ui';
import styles from './Round8bMocks.module.css';

const Filler = ({ children }: { children: ReactNode }) => <div className={styles.filler}>{children}</div>;

export function Round8bMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="round8b" title="Round 8b section separation: recipes A (framed) and B (rhythm and rule), boundary specimens">
      <Case wide label="Recipe A: panel on --bg-surface, 1px --border-subtle, 14px padding, 20px between panels, inner cards on --bg-elevated">
        <div className={styles.stage} data-recipe="a">
          <Filler>Previous section body (a card on --bg-elevated inside the panel)</Filler>
          <section className={styles.a} data-part="section">
            <SectionHeader level="xl" title="Comparison overview" description="Pass rates, winners and how many runs got each item right." />
            <Filler>Next section body</Filler>
          </section>
        </div>
      </Case>
      <Case wide label="Recipe B: 48px lead-in, 1px --border-strong rule (2.51:1), 14px below it, 3px start rail on the title band">
        <div className={styles.stage} data-recipe="b">
          <Filler>Previous section body</Filler>
          <section className={styles.b} data-part="section">
            <div className={styles.bHead} data-part="section-head">
              <SectionHeader level="xl" title="Comparison overview" description="Pass rates, winners and how many runs got each item right." />
            </div>
            <Filler>Next section body</Filler>
          </section>
        </div>
      </Case>
    </Sec>
  );
}
