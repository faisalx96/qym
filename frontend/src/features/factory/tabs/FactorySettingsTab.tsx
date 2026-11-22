/**
 * Factory → Settings: the grouping key (one of the source version's scalar metadata keys), the model connection,
 * the extra instructions for the two agents, and the Disconnect action. One card per concern with a save footer
 * (the project settings pattern); the body remounts on every saved detail so the draft starts from the server.
 */
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { useNavigate } from 'react-router-dom';
import { useDisconnectFactory, useUpdateFactory, type FactoryDetail } from '@/api/factory';
import { actionErrorMessage } from '@/lib/http';
import { CardHead } from '@/features/datasets/detail/SettingsTab';
import { SaveFooter } from '@/features/shell/settings/SettingsCard';
import { Button, Card, ConfirmDialog, Select, Text, Textarea, useToast } from '@/ui';
import { factoryPath } from '../lib/route';
import styles from '../FactoryDetailPage.module.css';

const NONE = '__none';
const DEFAULT = '__default';

function settingsSignature(f: FactoryDetail): string {
  return [
    f.group_metadata_key ?? '',
    f.llm_connection?.id ?? '',
    f.analysis_instructions,
    f.generation_instructions,
  ].join('\u0000');
}

export function FactorySettingsTab({
  factory,
  slug,
  canModify,
}: {
  factory: FactoryDetail;
  slug: string;
  canModify: boolean;
}) {
  return (
    <SettingsBody key={settingsSignature(factory)} factory={factory} slug={slug} canModify={canModify} />
  );
}

function SettingsBody({
  factory,
  slug,
  canModify,
}: {
  factory: FactoryDetail;
  slug: string;
  canModify: boolean;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const update = useUpdateFactory(factory.id);
  const disconnect = useDisconnectFactory(factory.id);
  const [groupKey, setGroupKey] = useState<Key | null>(factory.group_metadata_key ?? NONE);
  const [connection, setConnection] = useState<Key | null>(factory.llm_connection?.id ?? DEFAULT);
  const [analysis, setAnalysis] = useState(factory.analysis_instructions);
  const [generation, setGeneration] = useState(factory.generation_instructions);
  const [confirming, setConfirming] = useState(false);
  const keys = factory.metadata_keys;
  const known = keys.some((k) => k.key === factory.group_metadata_key);
  const keyItems = [
    { key: NONE, label: 'No grouping', description: 'One global group: every rule applies to every item' },
    ...(factory.group_metadata_key && !known
      ? [
          {
            key: factory.group_metadata_key,
            label: factory.group_metadata_key,
            description: 'Not found in the source version',
          },
        ]
      : []),
    ...keys.map((k) => ({
      key: k.key,
      label: k.key,
      description: `${k.value_count}${k.truncated ? '+' : ''} value${k.value_count === 1 ? '' : 's'}: ${k.values.slice(0, 6).join(', ')}${k.value_count > 6 ? '…' : ''}`,
    })),
  ];
  const connectionItems = [
    { key: DEFAULT, label: 'Project default connection' },
    ...factory.llm_connections.map((c) => ({
      key: c.id,
      label: c.name,
      description: `${c.model || 'no model'}${c.has_api_key ? '' : ' · no API key'}`,
    })),
  ];
  const groupingDirty = (groupKey === NONE ? null : String(groupKey)) !== factory.group_metadata_key;
  const modelDirty =
    (connection === DEFAULT ? null : String(connection)) !== (factory.llm_connection?.id ?? null);
  const instructionsDirty =
    analysis !== factory.analysis_instructions || generation !== factory.generation_instructions;

  async function save(action: string, body: Parameters<typeof update.mutateAsync>[0]) {
    try {
      await update.mutateAsync(body);
      toast.show('Settings saved', { tone: 'success' });
    } catch (e) {
      toast.show(actionErrorMessage(action, e), { tone: 'error' });
    }
  }

  return (
    <div className={styles.tab} data-testid="factory-settings-tab">
      <Card
        as="section"
        aria-labelledby="factory-grouping"
        header={
          <CardHead
            id="factory-grouping"
            title="Grouping"
            description="The item metadata key whose value groups the rules. A rule applies to the items of its group; rules without a group apply to every item."
          />
        }
      >
        <div className={styles.cardBody}>
          <Select
            label="Group rules by"
            items={keyItems}
            value={groupKey}
            onChange={setGroupKey}
            isDisabled={!canModify}
            searchable="auto"
            width="100%"
            help={
              factory.source_version
                ? `Scalar keys of ${factory.source_version.version}`
                : 'The dataset has no published version: no keys to list'
            }
          />
          {canModify ? (
            <SaveFooter
              dirty={groupingDirty}
              saving={update.isPending}
              onSave={() =>
                void save('save the grouping', {
                  group_metadata_key: groupKey === NONE ? null : String(groupKey),
                })
              }
            />
          ) : null}
        </div>
      </Card>
      <Card
        as="section"
        aria-labelledby="factory-model"
        header={
          <CardHead
            id="factory-model"
            title="Model"
            description="The project LLM connection the agents use. Connections are managed in Project settings."
          />
        }
      >
        <div className={styles.cardBody}>
          <Select
            label="LLM connection"
            items={connectionItems}
            value={connection}
            onChange={setConnection}
            isDisabled={!canModify}
            searchable={false}
            width="100%"
          />
          {canModify ? (
            <SaveFooter
              dirty={modelDirty}
              saving={update.isPending}
              onSave={() =>
                void save('save the model', {
                  llm_connection_id: connection === DEFAULT ? null : String(connection),
                })
              }
            />
          ) : null}
        </div>
      </Card>
      <Card
        as="section"
        aria-labelledby="factory-instructions"
        header={
          <CardHead
            id="factory-instructions"
            title="Agent instructions"
            description="Extra guidance appended to the prompts: the domain, the language, what to leave alone."
          />
        }
      >
        <div className={styles.cardBody}>
          <div className={styles.fields}>
            <Textarea
              label="Rule analysis"
              value={analysis}
              onChange={setAnalysis}
              rows={5}
              isDisabled={!canModify}
              placeholder="Rules are about the bank's retail products; write them in English."
              data-testid="analysis-instructions"
            />
            <Textarea
              label="Data generation"
              value={generation}
              onChange={setGeneration}
              rows={5}
              isDisabled={!canModify}
              placeholder="Keep every question under 60 words; never invent product names."
              data-testid="generation-instructions"
            />
          </div>
          {canModify ? (
            <SaveFooter
              dirty={instructionsDirty}
              saving={update.isPending}
              onSave={() =>
                void save('save the instructions', {
                  analysis_instructions: analysis,
                  generation_instructions: generation,
                })
              }
            />
          ) : null}
        </div>
      </Card>
      {factory.permissions.can_disconnect && canModify ? (
        <Card
          as="section"
          tone="danger"
          aria-labelledby="factory-disconnect"
          header={
            <CardHead
              id="factory-disconnect"
              title="Disconnect"
              description="The rules, categories and jobs of this factory go. Generated datasets stay."
            />
          }
        >
          <div className={styles.cardBody}>
            <Text as="p" variant="sm" tone="muted">
              {factory.counts.rules} rule{factory.counts.rules === 1 ? '' : 's'} and {factory.counts.jobs} job
              {factory.counts.jobs === 1 ? '' : 's'} would be removed.
            </Text>
            <div>
              <Button
                variant="danger"
                onPress={() => setConfirming(true)}
                isDisabled={Boolean(factory.active_job)}
                disabledReason="Cancel the running job first"
                data-testid="disconnect"
              >
                Disconnect dataset
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect “${factory.dataset?.name ?? 'this dataset'}” from the factory?`}
        description={[
          'Its rules, categories and job history are removed. The dataset and the generated datasets stay.',
        ]}
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={async () => {
          try {
            await disconnect.mutateAsync();
            toast.show('Dataset disconnected', { tone: 'info' });
            navigate(factoryPath(slug));
          } catch (e) {
            toast.show(actionErrorMessage('disconnect the dataset', e), { tone: 'error' });
          }
        }}
      />
    </div>
  );
}
