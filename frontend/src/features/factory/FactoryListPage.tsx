/**
 * /projects/:slug/factory — the datasets connected to the data factory, one card each (rules, official rules,
 * categories, grouping key, last analysis), and the Connect dataset action. A card grid page: the primary action
 * sits in the PageHeader (DESIGN_LANGUAGE §4).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConnectDataset, useFactories, type Factory } from '@/api/factory';
import { formatAgo } from '@/lib/dates';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Flag,
  Icon,
  PageHeader,
  Skeleton,
  Tag,
  Text,
  useToast,
} from '@/ui';
import { ConnectDialog } from './dialogs';
import { factoryPath } from './lib/route';
import styles from './FactoryListPage.module.css';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function FactoryCard({ factory, slug }: { factory: Factory; slug: string }) {
  const name = factory.dataset?.name ?? 'Deleted dataset';
  return (
    <Card as="li" to={factoryPath(slug, factory.id)} className={styles.entry} data-testid="factory-card">
      <div className={styles.head}>
        <Text variant="md" weight={600} as="h2" className={styles.name}>
          <span dir="auto">{name}</span>
        </Text>
        <span className={styles.flags}>
          {factory.counts.active_jobs ? (
            <Flag tone="info" icon="clock">
              Job running
            </Flag>
          ) : null}
          {factory.access_mode === 'restricted' ? <Flag icon="lock">Restricted</Flag> : null}
        </span>
      </div>
      <div className={styles.stats}>
        <Tag kind="count">{plural(factory.counts.rules, 'rule')}</Tag>
        <Tag kind="count" tone={factory.counts.official_rules ? 'success' : undefined}>
          {factory.counts.official_rules} official
        </Tag>
        <Tag kind="count">
          {factory.counts.categories} {factory.counts.categories === 1 ? 'category' : 'categories'}
        </Tag>
      </div>
      <dl className={styles.meta}>
        <dt>Grouped by</dt>
        <dd>
          {factory.group_metadata_key ? (
            <Tag kind="config">{factory.group_metadata_key}</Tag>
          ) : (
            <span className={styles.muted}>No grouping</span>
          )}
        </dd>
        <dt>Last analysis</dt>
        <dd>
          {factory.last_analyzed_at ? (
            formatAgo(factory.last_analyzed_at)
          ) : (
            <span className={styles.muted}>Not yet</span>
          )}
        </dd>
      </dl>
    </Card>
  );
}

export function FactoryListPage() {
  const { slug, project, readOnly } = useProjectContext();
  useDocumentTitle('Factory');
  const navigate = useNavigate();
  const toast = useToast();
  const list = useFactories(slug);
  const connect = useConnectDataset(slug);
  const showSkeleton = useDelayedPending(list.isPending);
  const [connecting, setConnecting] = useState(false);
  const factories = list.data?.factories ?? [];

  return (
    <div className={constrained} data-testid="factory-page">
      <PageHeader
        title="Factory"
        description="Business rules an agent reads from a dataset, and new items generated from them."
        meta={list.data ? [<span key="count">{plural(factories.length, 'connected dataset')}</span>] : []}
        actions={
          readOnly ? null : (
            <Button
              variant="primary"
              icon={<Icon name="plus" size={12} />}
              onPress={() => setConnecting(true)}
              data-testid="connect-dataset"
            >
              Connect dataset
            </Button>
          )
        }
      />
      {list.isError ? (
        <ErrorState error={list.error} title="Couldn’t load the factory" onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        showSkeleton ? (
          <Skeleton kind="lines" rows={4} label="Loading the factory" />
        ) : null
      ) : factories.length === 0 ? (
        <EmptyState
          icon={<Icon name="factory" size={20} />}
          title="No dataset is connected yet"
          body={
            readOnly
              ? 'A member connects a dataset; the agent then extracts its business rules here.'
              : 'Connect a dataset you may modify. The agent reads its items, proposes business rules per category, and generates new items from the rules you make official.'
          }
          action={
            readOnly ? undefined : (
              <Button variant="primary" onPress={() => setConnecting(true)}>
                Connect dataset
              </Button>
            )
          }
          guide="/docs/platform-guide/projects-data-review"
        />
      ) : (
        <ul className={styles.grid} aria-label="Connected datasets">
          {factories.map((f) => (
            <FactoryCard key={f.id} factory={f} slug={slug} />
          ))}
        </ul>
      )}
      <ConnectDialog
        open={connecting}
        onOpenChange={setConnecting}
        slug={slug}
        projectId={project.id}
        connectedDatasetIds={list.data?.connected_dataset_ids ?? []}
        onConnect={async (body) => {
          const created = await connect.mutateAsync(body);
          toast.show(`${created.dataset?.name ?? 'Dataset'} connected`, { tone: 'success' });
          navigate(factoryPath(slug, created.id));
        }}
      />
    </div>
  );
}

export default FactoryListPage;
