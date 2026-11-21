import { Card, Skeleton, Text } from '@/ui';
import { TurnCardTitle } from './Evidence';
import styles from './JudgesTab.module.css';

/** Reserve the same cards and core facets as the loaded judge tab. */
export function JudgesLoading() {
  const facets = ['Scores', 'Reasoning', 'Deviations'];
  return (
    <div className={styles.stack}>
      <div className={styles.columns}>
        {['A', 'B'].map((side) => (
          <Card key={side} flush header={<TurnCardTitle title={`Judge ${side}`} />}>
            {facets.map((facet) => (
              <section key={facet} className={styles.facet}>
                <div className={styles.facetInner}>
                  <Text as="h3" variant="base" weight={600}>
                    {facet}
                  </Text>
                  <Skeleton
                    kind="lines"
                    rows={facet === 'Scores' ? 2 : 4}
                    label={`Loading Judge ${side} ${facet.toLowerCase()}`}
                  />
                </div>
              </section>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
