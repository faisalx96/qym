import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type CreateDraftBody,
  type FeedbackSubject,
  type TargetKind,
  useCreateFeedback,
  useFeedbackStatus,
  useFeedbackTargets,
} from '@/api/feedback';
import { ApiError } from '@/lib/http';
import { useAuth } from '@/features/shell/AuthContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { constrained } from '@/features/shell/layout';
import { useSearchParamsState } from '@/lib/url-state';
import { useSubmitLock } from '@/lib/pending';
import { Button, Card, Icon, PageHeader, RadioGroup, SegmentedControl, Select, Text, Textarea, useToast } from '@/ui';
import { NotConfigured } from './NotConfigured';
import styles from './feedback.module.css';

const MAX = 4000;
const SHOW_COUNTER = 3600;
const STORE = 'qym:feedback-new-text';

function readDraft(): string {
  try {
    return sessionStorage.getItem(STORE) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(v: string | null) {
  try {
    if (v) sessionStorage.setItem(STORE, v);
    else sessionStorage.removeItem(STORE);
  } catch {
    /* storage can be unavailable */
  }
}

function HowItWorks() {
  return (
    <Card as="aside" aria-label="How it works" header={<Text variant="md">How it works</Text>}>
      <ol className={styles.steps}>
        <li>
          <span className={styles.stepNo}>1</span>
          <span>You describe the need in your own words.</span>
        </li>
        <li>
          <span className={styles.stepNo}>2</span>
          <span>The assistant asks the questions the team will ask later, usually four to eight.</span>
        </li>
        <li>
          <span className={styles.stepNo}>3</span>
          <span>You confirm a description, a priority and a complexity. Nothing is submitted before you do.</span>
        </li>
      </ol>
      <p className={styles.note}>Everyone signed in can read a submitted request. Administrators decide its status.</p>
    </Card>
  );
}

/** /feedback/new: the subject step; the first message creates the draft and opens /feedback/<uuid> (QE-D2). */
export function NewFeedbackPage() {
  useDocumentTitle('New feedback');
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAuth();
  const status = useFeedbackStatus();
  const { get } = useSearchParamsState();
  const create = useCreateFeedback();
  const lock = useSubmitLock();
  const projects = me.projects.filter((p) => p.is_active !== false);
  const [subject, setSubject] = useState<FeedbackSubject>(get('subject') === 'product' ? 'product' : 'platform');
  const [project, setProject] = useState<string>(() => {
    const wanted = get('project');
    return projects.find((p) => p.slug === wanted)?.slug ?? '';
  });
  const [kind, setKind] = useState<TargetKind | 'none'>(() => {
    const k = get('kind');
    return k === 'run' || k === 'experiment' || k === 'dataset' ? k : 'none';
  });
  const [target, setTarget] = useState<string>(get('target'));
  const [text, setText] = useState(readDraft);
  const [error, setError] = useState('');
  const targets = useFeedbackTargets(subject === 'product' ? project : '', kind);

  if (status.data && !status.data.configured) return <NotConfigured />;
  const ready = text.trim().length > 0 && (subject === 'platform' || Boolean(project));
  const change = (v: string) => {
    setText(v);
    writeDraft(v);
  };
  const start = () =>
    lock(async () => {
      setError('');
      const body: CreateDraftBody = { subject, message: text.trim() };
      if (subject === 'product') {
        body.project_id = project;
        if (kind !== 'none' && target) body.target = { kind, id: target };
      }
      try {
        const res = await create.mutateAsync(body);
        writeDraft(null);
        navigate(`/feedback/${res.id}`, { replace: true });
      } catch (e) {
        const msg = e instanceof ApiError && e.detail ? e.detail : 'Couldn’t start the conversation. Your text is kept.';
        setError(msg);
        toast.show(msg, { tone: 'error' });
      }
    });

  return (
    <div className={`${constrained} ${styles.page}`} data-testid="feedback-new-page">
      <PageHeader
        title="New feedback"
        description="Tell the assistant what you need. It proposes a request for you to confirm."
      />
      <div className={styles.split}>
        <Card
          as="section"
          aria-label="New feedback"
          data-testid="new-form"
          footer={
            <div className={styles.formFoot}>
              <span className={styles.visibility}>
                <Icon name="eye" size={14} /> Visible to everyone signed in
              </span>
              <span className={styles.footActions}>
                <Button
                  variant="ghost"
                  onPress={() => {
                    writeDraft(null);
                    navigate('/feedback');
                  }}
                >
                  Cancel
                </Button>
                <Button variant="accent" isDisabled={!ready} loading={create.isPending} onPress={() => void start()}>
                  Start conversation
                </Button>
              </span>
            </div>
          }
        >
          <div className={styles.formBody}>
            <RadioGroup
              label="What is this about?"
              value={subject}
              onChange={(v) => setSubject(v as FeedbackSubject)}
              options={[
                {
                  value: 'platform',
                  title: 'qym itself',
                  help: 'A need or a change for qym: its pages, API, SDK or CLI. The assistant knows the qym documentation.',
                },
                {
                  value: 'product',
                  title: 'A product I evaluate with qym',
                  help: 'About one of your projects: its runs, experiments or datasets. The assistant knows that project’s setup.',
                },
              ]}
            />
            {subject === 'product' ? (
              <div className={styles.target} data-testid="product-fields">
                <Select
                  label="Project"
                  isRequired
                  items={projects.map((p) => ({ key: p.slug, label: p.name }))}
                  value={project || null}
                  onChange={(k) => {
                    setProject(k ? String(k) : '');
                    setTarget('');
                  }}
                />
                <div className={styles.targetPick}>
                  <SegmentedControl
                    label="Point at"
                    value={kind}
                    onChange={(k) => {
                      setKind(k);
                      setTarget('');
                    }}
                    options={[
                      { value: 'none', label: 'Nothing' },
                      { value: 'run', label: 'Run' },
                      { value: 'experiment', label: 'Experiment' },
                      { value: 'dataset', label: 'Dataset' },
                    ]}
                  />
                  {kind !== 'none' ? (
                    <Select
                      label={kind.charAt(0).toUpperCase() + kind.slice(1)}
                      items={(targets.data?.items ?? []).map((t) => ({ key: t.id, label: t.label }))}
                      value={target || null}
                      onChange={(k) => setTarget(k ? String(k) : '')}
                      searchable="auto"
                      placeholder={targets.isPending ? 'Loading…' : 'Choose one'}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
            <Textarea
              label="What do you need?"
              rows={5}
              value={text}
              onChange={change}
              maxLength={MAX}
              placeholder="Describe it in your own words. One or two sentences are enough, the assistant asks the rest."
              help={
                <>
                  English and Arabic both work. Do not paste secrets or customer data.
                  {text.length >= SHOW_COUNTER ? (
                    <>
                      {' '}
                      <span className={styles.counter} data-over={text.length >= MAX ? '' : undefined}>
                        {text.length.toLocaleString('en-US')} / {MAX.toLocaleString('en-US')}
                      </span>
                    </>
                  ) : null}
                </>
              }
              errorMessage={error || undefined}
            />
          </div>
        </Card>
        <HowItWorks />
      </div>
    </div>
  );
}
