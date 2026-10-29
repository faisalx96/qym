import { useState } from 'react';
import { Callout } from '@/features/experiments/launch/components/Callout';
import {
  useAgentAdmin,
  useRemoveAgent,
  useSaveAgent,
  useTestAgent,
  type AgentAdmin,
  type AgentTestResult,
} from '@/api/feedback';
import feedbackStyles from '@/features/feedback/feedback.module.css';
import { ApiError } from '@/lib/http';
import { KEY_FOR_NEW_HOST_PLACEHOLDER, keyHostChanged } from '@/lib/keyHost';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  NumberField,
  Skeleton,
  StatStrip,
  StatusMark,
  Text,
  TextField,
  useToast,
} from '@/ui';

function ConnectionCard({ data }: { data: AgentAdmin }) {
  const toast = useToast();
  const save = useSaveAgent();
  const test = useTestAgent();
  const remove = useRemoveAgent();
  const [url, setUrl] = useState(data.connection.llm_base_url);
  const [model, setModel] = useState(data.connection.llm_model);
  const [key, setKey] = useState('');
  const [result, setResult] = useState<AgentTestResult | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const stored = data.connection;
  // The stored key stays with its host: another host needs the key again (C004).
  // A blank URL tests the saved one, as the server does.
  const needsKey =
    stored.llm_api_key_set && keyHostChanged(stored.llm_base_url, url.trim() || stored.llm_base_url);
  const complete = Boolean(url.trim() && model.trim() && (key || (stored.llm_api_key_set && !needsKey)));
  const canTest = (data.configured && !needsKey) || Boolean(url.trim() && model.trim() && key);
  const blocked = !data.encryption_ready;
  const values = () => ({
    llm_base_url: url.trim(),
    llm_model: model.trim(),
    ...(key ? { llm_api_key: key } : {}),
  });
  return (
    <Card
      as="section"
      aria-label="Connection"
      data-testid="connection"
      header={
        <div className={feedbackStyles.railHead}>
          <Text variant="md">Connection</Text>
          {data.configured ? (
            <StatusMark tone="success" shape="full" label="Configured" />
          ) : (
            <StatusMark tone="warning" shape="ring" label="Not configured" />
          )}
        </div>
      }
      footer={
        <div className={feedbackStyles.footActions}>
          {data.configured ? (
            <Button variant="danger" onPress={() => setRemoving(true)}>
              Remove connection
            </Button>
          ) : null}
          {/* the button rule (round 11): Test runs something without saving (accent), Save commits (primary) */}
          <Button
            variant="accent"
            icon={<Icon name="play" size={14} />}
            isDisabled={!canTest}
            loading={test.isPending}
            onPress={async () => {
              setError('');
              setResult(null);
              try {
                setResult(await test.mutateAsync(values()));
              } catch (e) {
                setError(e instanceof ApiError && e.detail ? e.detail : 'The test could not run.');
              }
            }}
          >
            Test connection
          </Button>
          <Button
            variant="primary"
            isDisabled={blocked || !complete}
            loading={save.isPending}
            onPress={async () => {
              setError('');
              try {
                await save.mutateAsync({ ...values(), ...(key ? {} : { llm_api_key: '__KEEP__' }) });
                setKey('');
                toast.show('Connection saved', { tone: 'success' });
              } catch (e) {
                setError(e instanceof ApiError && e.detail ? e.detail : 'Couldn’t save the connection.');
              }
            }}
          >
            Save connection
          </Button>
        </div>
      }
    >
      <div className={feedbackStyles.triageBody}>
        {blocked ? (
          <Callout tone="error" title="Saving is blocked: the platform has no encryption key" live>
            Set QYM_LLM_CONFIG_ENCRYPTION_KEY on the server and restart it. The API key is never stored in
            clear text.
          </Callout>
        ) : null}
        <div className={feedbackStyles.connGrid}>
          <TextField
            label="Base URL"
            mono
            isRequired
            value={url}
            onChange={setUrl}
            placeholder="https://api.openai.com/v1"
            help="Any OpenAI-compatible endpoint. An https:// URL is required."
          />
          <TextField
            label="Model"
            mono
            isRequired
            value={model}
            onChange={setModel}
            placeholder="gpt-4.1"
            help="Must support tool calls."
          />
          <TextField
            label="API key"
            type="password"
            mono
            value={key}
            onChange={setKey}
            isRequired={needsKey}
            placeholder={
              needsKey
                ? KEY_FOR_NEW_HOST_PLACEHOLDER
                : stored.llm_api_key_set
                  ? `Keep current (${stored.llm_api_key_hint})`
                  : 'sk-…'
            }
            autoComplete="new-password"
          />
        </div>
        {result?.ok ? (
          <Callout tone="success" title="Connected" live>
            Connected: {result.model} answered in {result.latency_ms} ms and called a test tool.
          </Callout>
        ) : null}
        {result && !result.ok ? (
          <Callout tone="error" title="The connection test failed" live>
            {result.detail || 'The endpoint did not answer.'} Nothing was changed.
          </Callout>
        ) : null}
        {error ? (
          <Callout tone="error" title="Couldn’t complete that" live>
            {error}
          </Callout>
        ) : null}
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the connection?"
        description="Feedback will show not configured. Existing requests are kept."
        confirmLabel="Remove connection"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync();
          setUrl('');
          setModel('');
          setResult(null);
          toast.show('Connection removed', { tone: 'success' });
        }}
      />
    </Card>
  );
}

function BehaviourCard({ data }: { data: AgentAdmin }) {
  const toast = useToast();
  const save = useSaveAgent();
  const [days, setDays] = useState(data.behaviour.draft_retention_days);
  const [max, setMax] = useState(data.behaviour.max_user_messages);
  return (
    <Card
      as="section"
      aria-label="Behaviour"
      header={<Text variant="md">Behaviour</Text>}
      footer={
        <div className={feedbackStyles.footActions}>
          <Button
            variant="primary"
            loading={save.isPending}
            onPress={async () => {
              try {
                await save.mutateAsync({ draft_retention_days: days, max_user_messages: max });
                toast.show('Behaviour saved', { tone: 'success' });
              } catch (e) {
                toast.show(e instanceof ApiError && e.detail ? e.detail : 'Couldn’t save.', {
                  tone: 'error',
                });
              }
            }}
          >
            Save behaviour
          </Button>
        </div>
      }
    >
      <div className={feedbackStyles.connGrid}>
        <NumberField
          label="Keep drafts for (days)"
          value={days}
          onChange={setDays}
          minValue={1}
          maxValue={365}
          help="A draft nobody submitted is deleted after this many days."
        />
        <NumberField
          label="Most messages per request"
          value={max}
          onChange={setMax}
          minValue={6}
          maxValue={100}
          help="After this many of the person’s messages the assistant must propose."
        />
      </div>
    </Card>
  );
}

/** Admin, Feedback agent (QE-109 to QE-122): the platform-level connection and the two numbers. */
export function FeedbackAgentTab() {
  const q = useAgentAdmin();
  if (q.isError)
    return (
      <ErrorState
        error={q.error}
        title="Couldn’t load the feedback assistant"
        onRetry={() => void q.refetch()}
      />
    );
  if (!q.data) return <Skeleton kind="rows" rows={3} rowHeight={80} label="Loading the feedback assistant" />;
  const key = String(q.data.configured);
  const d = q.data;
  return (
    <div className={feedbackStyles.stackCol}>
      <StatStrip
        variant="compact-header"
        aria-label="Feedback totals"
        items={[
          { label: 'Requests', value: d.counts.requests, sub: `${d.counts.new} new` },
          {
            label: 'Open drafts',
            value: d.counts.open_drafts,
            sub: `deleted after ${d.behaviour.draft_retention_days} days`,
          },
          { label: 'Assistant calls, 7 days', value: d.counts.assistant_calls_7d },
        ]}
      />
      <ConnectionCard key={key} data={q.data} />
      <BehaviourCard key={`b-${key}`} data={q.data} />
    </div>
  );
}
