/**
 * "Used by runs, not registered" (C030): the dataset names the project's runs used that no dataset registers, each
 * with its run count and a Register action that opens New dataset with that name.
 */
import { useUnregisteredDatasetNames } from '@/api/datasets';
import { Button, Card, Text } from '@/ui';
import styles from './CatalogPage.module.css';

export function UnregisteredNames({
  slug,
  canRegister,
  onRegister,
}: {
  slug: string;
  canRegister: boolean;
  onRegister: (name: string) => void;
}) {
  const query = useUnregisteredDatasetNames(slug);
  const names = query.data?.names ?? [];
  if (!names.length) return null;
  const more = (query.data?.total ?? names.length) - names.length;
  return (
    <Card
      as="section"
      className={styles.unregistered}
      aria-labelledby="unregistered-title"
      data-testid="unregistered-names"
    >
      <header className={styles.unregisteredHead}>
        <Text variant="lg" as="h2" id="unregistered-title">
          Used by runs, not registered
        </Text>
        <Text variant="sm" tone="muted" as="p">
          Runs used these dataset names, but no dataset of this project has them. Register one to version its
          items here.
        </Text>
      </header>
      <ul className={styles.unregisteredList}>
        {names.map((n) => (
          <li key={n.name} className={styles.unregisteredRow}>
            <span className={styles.unregisteredName} dir="auto">
              {n.name}
            </span>
            <Text variant="sm" tone="muted" as="span" mono>
              {n.runs.toLocaleString()} {n.runs === 1 ? 'run' : 'runs'}
            </Text>
            {canRegister ? (
              <Button variant="neutral" size="sm" onPress={() => onRegister(n.name)}>
                Register
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <Text variant="sm" tone="muted" as="p">
          and {more.toLocaleString()} more
        </Text>
      ) : null}
    </Card>
  );
}
