import type { CSSProperties } from 'react';
import { Card, Skeleton, Text } from '@/ui';
import styles from './JudgesTab.module.css';

/** Core facets share the loaded column tracks; optional evidence is not known yet. */
export function JudgesLoading() {
  const facets = [
    'Scores',
    'Checks',
    'Against the agent',
    'Reasoning',
    'Review of the other judge',
    'Own SQL',
  ];
  return (
    <>
      <Skeleton kind="lines" rows={1} label="Loading judge comparison" />
      <div className={styles.columns}>
        {['A', 'B'].map((side) => (
          <Card
            key={side}
            className={styles.judge}
            style={{ '--judge-rows': facets.length + 1 } as CSSProperties}
          >
            <div className={styles.identity}>
              <Text as="h2" variant="md" weight={600}>
                Judge {side}
              </Text>
            </div>
            {facets.map((facet) => (
              <section key={facet} className={styles.facet}>
                <Text as="h3" variant="md" weight={600}>
                  {facet}
                </Text>
                <Skeleton kind="lines" rows={3} label={`Loading Judge ${side} ${facet.toLowerCase()}`} />
              </section>
            ))}
          </Card>
        ))}
      </div>
    </>
  );
}
