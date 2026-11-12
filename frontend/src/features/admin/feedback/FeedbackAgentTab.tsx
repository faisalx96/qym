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
import {
  ConnectionFields,
  httpsError,
  placeConnectionError,
  type ConnectionErrors,
} from '@/features/shell/settings/ConnectionFields';
import { SaveFooter } from '@/features/shell/settings/SettingsCard';
import { formatDuration } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { keyHostChanged } from '@/lib/keyHost';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  NumberField,
  Section,
  Skeleton,
  StatusMark,
  Text,
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
  const [fieldErrors, setFieldErrors] = useState<ConnectionErrors>({});
  const [removing, setRemoving] = useState(false);
  /** The https rule before any request (C157). */
  function checked(): boolean {
    const https = httpsError(url, true);
    setFieldErrors(https ? { baseUrl: https } : {});
    return !https;
  }
  /** A server error goes under its field; anything else stays in the callout. */
  function place(e: unknown, fallback: string) {
    const placed = placeConnectionError(e instanceof ApiError && e.detail ? e.detail : fallback);
    setFieldErrors(placed.errors);
    setError(placed.formError);
  }
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
  const dirty = url.trim() !== stored.llm_base_url || model.trim() !== stored.llm_model || Boolean(key);
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
        <SaveFooter
          dirty={dirty}
          isDisabled={!complete || blocked}
          disabledReason={!complete || blocked ? 'Fill in every field' : undefined}
          saving={save.isPending}
          onSave={async () => {
            setError('');
            if (!checked()) return;
            try {
              await save.mutateAsync({ ...values(), ...(key ? {} : { llm_api_key: '__KEEP__' }) });
              setKey('');
              toast.show('Connection saved', { tone: 'success' });
            } catch (e) {
              place(e, 'Couldn’t save the connection.');
            }
          }}
          secondary={
            <>
              {data.configured ? (
                <Button variant="danger" onPress={() => setRemoving(true)}>
                  Remove connection
                </Button>
              ) : null}
              <Button
                variant="accent"
                icon={<Icon name="play" size={12} />}
                isDisabled={!canTest}
                disabledReason="Fill in every field"
                loading={test.isPending}
                onPress={async () => {
                  setError('');
                  setResult(null);
                  if (!checked()) return;
                  try {
                    setResult(await test.mutateAsync(values()));
                  } catch (e) {
                    place(e, 'The test could not run.');
                  }
                }}
              >
                Test connection
              </Button>
            </>
          }
        />
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
          {/* One connection recipe with Project settings, errors under their field (C157). */}
          <ConnectionFields
            baseUrl={url}
            onBaseUrl={(v) => {
              setUrl(v);
              if (fieldErrors.baseUrl) setFieldErrors((e) => ({ ...e, baseUrl: undefined }));
            }}
            model={model}
            onModel={(v) => {
              setModel(v);
              if (fieldErrors.model) setFieldErrors((e) => ({ ...e, model: undefined }));
            }}
            apiKey={key}
            onApiKey={(v) => {
              setKey(v);
              if (fieldErrors.key) setFieldErrors((e) => ({ ...e, key: undefined }));
            }}
            needsKey={needsKey}
            storedKeyHint={stored.llm_api_key_set ? stored.llm_api_key_hint : null}
            baseUrlHelp="Any OpenAI-compatible endpoint. An https:// URL is required."
            modelHelp="Must support tool calls."
            errors={fieldErrors}
          />
        </div>
        {result?.ok ? (
          <Callout tone="success" title="Connected" live>
            Connected: {result.model} answered in {formatDuration(result.latency_ms)} and called a test tool.
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
        <SaveFooter
          dirty={days !== data.behaviour.draft_retention_days || max !== data.behaviour.max_user_messages}
          saving={save.isPending}
          onSave={async () => {
            try {
              await save.mutateAsync({ draft_retention_days: days, max_user_messages: max });
              toast.show('Behaviour saved', { tone: 'success' });
            } catch (e) {
              toast.show(e instanceof ApiError && e.detail ? e.detail : 'Couldn’t save.', {
                tone: 'error',
              });
            }
          }}
        />
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

/** Admin, Feedback assistant (QE-109 to QE-122, C244): the platform-level connection and the two numbers. */
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
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // One titled Section, its totals in the description: no second stat strip under the admin tiles (C244).
  const totals = [
    `${plural(d.counts.requests, 'request')}, ${d.counts.new} new`,
    `${plural(d.counts.open_drafts, 'open draft')}, deleted after ${d.behaviour.draft_retention_days} days`,
    `${plural(d.counts.assistant_calls_7d, 'assistant call')} in 7 days`,
  ].join(' · ');
  return (
    <Section title="Feedback assistant" description={totals} bodyClassName={feedbackStyles.stackCol}>
      <ConnectionCard key={key} data={q.data} />
      <BehaviourCard key={`b-${key}`} data={q.data} />
    </Section>
  );
}
