/** /__ui "Colour as information": the visual-language primitives in every state (docs/DESIGN_LANGUAGE.md §3). */
import { useState, type ReactNode } from 'react';
import {
  Badge,
  Card,
  ChartTooltipHost,
  Chip,
  DeltaCell,
  Eyebrow,
  Icon,
  KeyValueGrid,
  Mark,
  ScoreBar,
  ScoreValue,
  SectionHeader,
  SeriesHighlightRoot,
  Stack,
  StatStrip,
  Tag,
  Text,
  useSeriesHighlight,
} from '@/ui';
import { RateBar } from '@/features/run-detail/components/charts/Charts';
import styles from './UiGalleryPage.module.css';

function Case({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={styles.case} data-case={label} data-wide={wide ? '' : undefined}>
      <Eyebrow>{label}</Eyebrow>
      <div className={styles.caseBody}>{children}</div>
    </div>
  );
}

const TONES = ['success', 'info', 'warning', 'danger', 'accent', 'meta', 'neutral'] as const;
const SERIES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function SeriesDot({ n }: { n: (typeof SERIES)[number] }) {
  const h = useSeriesHighlight(n);
  return (
    <Mark as="button" series={n} onPick={() => undefined} {...h} aria-label={`Series ${n}`}>
      <span style={{ display: 'inline-block', width: 24, height: 24, background: `var(--chart-${n})` }} />
    </Mark>
  );
}

export function VisualLanguageGallery() {
  const [selected, setSelected] = useState(false);
  const [chip, setChip] = useState<Record<string, boolean>>({ a: true, b: true, c: true });
  const [stat, setStat] = useState<string | null>('errors');
  const [mark, setMark] = useState<number | null>(null);
  return (
    <section className={styles.section} id="visual-language" data-gallery-section="visual-language">
      <SectionHeader
        title="Colour as information"
        description="One colour, one meaning: band (score quality), status, delta, severity, series, definition metadata. Teal is interaction, never data."
      />
      <div className={styles.grid}>
        <Case label="Card tones (rail)" wide>
          <Stack direction="row" gap="md" wrap>
            {TONES.map((t) => (
              <Card key={t} tone={t} style={{ width: 160 }}>
                <Text variant="md">{t}</Text>
              </Card>
            ))}
          </Stack>
        </Case>
        <Case label="Card band, series, wash" wide>
          <Stack direction="row" gap="md" wrap>
            {([1, 2, 3, 4, 5] as const).map((b) => (
              <Card key={b} band={b} compact style={{ width: 120 }}>
                band {b}
              </Card>
            ))}
            {SERIES.map((n) => (
              <Card key={n} series={n} compact style={{ width: 120 }}>
                series {n}
              </Card>
            ))}
            <Card wash="danger" tone="danger" style={{ width: 160 }}>
              wash danger
            </Card>
            <Card wash="live" tone="info" style={{ width: 160 }}>
              wash live
            </Card>
          </Stack>
        </Case>
        <Case label="Card states (interactive)" wide>
          <Stack direction="row" gap="md" wrap>
            <Card style={{ width: 200 }}>passive: no hover</Card>
            <Card band={3} onPress={() => undefined} style={{ width: 200 }}>
              interactive (hover, press)
            </Card>
            <Card
              band={4}
              onPress={() => setSelected((v) => !v)}
              isSelected={selected}
              style={{ width: 200 }}
              data-testid="gallery-card-select"
            >
              selectable ({selected ? 'selected' : 'off'})
            </Card>
            <Card to="/__ui" tone="accent" style={{ width: 200 }}>
              link card
            </Card>
            <Card onPress={() => undefined} isDisabled style={{ width: 200 }}>
              disabled
            </Card>
            <Card
              header={<Text variant="md">Header</Text>}
              footer={<Text variant="sm">Footer</Text>}
              style={{ width: 200 }}
            >
              header and footer
            </Card>
          </Stack>
        </Case>
        <Case label="Badge tones and glyph">
          <Stack direction="row" gap="sm" wrap>
            {TONES.map((t) => (
              <Badge key={t} tone={t}>
                {t}
              </Badge>
            ))}
            <Badge tone="success" glyph="✓">
              approved
            </Badge>
          </Stack>
        </Case>
        <Case label="Tag kinds (definition metadata is purple)">
          <Stack direction="row" gap="sm" wrap>
            <Tag kind="task">rag_answer</Tag>
            <Tag kind="version">v7</Tag>
            <Tag kind="config">temperature</Tag>
            <Tag kind="dataset">qa-arabic-v3</Tag>
            <Tag kind="model" series={2}>
              gpt-5-mini
            </Tag>
            <Tag kind="model" series={6}>
              claude
            </Tag>
            <Tag kind="origin">local</Tag>
            <Tag tone="info">official</Tag>
            <Tag kind="count">12</Tag>
          </Stack>
        </Case>
        <Case label="Chip tone and series (selected colour)">
          <Stack direction="row" gap="sm" wrap>
            <Chip isSelected={chip.a} onChange={(v) => setChip({ ...chip, a: v })}>
              accent (default)
            </Chip>
            <Chip tone="danger" isSelected={chip.b} onChange={(v) => setChip({ ...chip, b: v })}>
              failed
            </Chip>
            <Chip series={3} isSelected={chip.c} onChange={(v) => setChip({ ...chip, c: v })}>
              complexity
            </Chip>
          </Stack>
        </Case>
        <Case label="ScoreValue text and pill">
          <Stack gap="sm">
            <Stack direction="row" gap="sm">
              {[0.2, 0.5, 0.65, 0.8, 0.95].map((v) => (
                <ScoreValue key={v} value={v} direction="higher" />
              ))}
            </Stack>
            <Stack direction="row" gap="sm">
              {[0.2, 0.5, 0.65, 0.8, 0.95].map((v) => (
                <ScoreValue key={v} value={v} direction="higher" variant="pill" />
              ))}
              <ScoreValue value={0.5} variant="pill" />
              <ScoreValue value={null} error="task" variant="pill" />
            </Stack>
          </Stack>
        </Case>
        <Case label="ScoreBar (grow-in, series, marker, lg)">
          <Stack gap="sm">
            <ScoreBar value={0.92} direction="higher" width={120} />
            <ScoreBar value={0.45} direction="higher" width={120} index={1} />
            <ScoreBar value={0.2} direction="higher" width={120} index={2} />
            <ScoreBar value={0.7} series={2} width={120} />
            <ScoreBar value={0.7} series={4} width={120} height="md" marker={0.5} />
            <ScoreBar value={0.82} direction="higher" size="lg" />
            <ScoreBar value={0.18} direction="higher" size="lg" />
          </Stack>
        </Case>
        <Case label="RateBar (band, series, neutral)">
          <Stack gap="sm">
            <RateBar value={0.8} label="80%" band={4} />
            <RateBar value={0.49} label="49%" band={2} index={1} />
            <RateBar value={0.25} label="25%" band={1} index={2} />
            <RateBar value={0.6} label="series 3" series={3} />
            <RateBar value={0.6} label="neutral" />
          </Stack>
        </Case>
        <Case label="DeltaCell (plain and pill)">
          <Stack direction="row" gap="md" wrap>
            <DeltaCell value={0.073} direction="higher" />
            <DeltaCell value={0.073} direction="higher" emphasis />
            <DeltaCell value={-0.05} direction="higher" emphasis />
            <DeltaCell value={0.004} direction="higher" noise={0.01} emphasis />
          </Stack>
        </Case>
        <Case label="StatStrip tones, tile icons, trend, press" wide>
          <StatStrip
            items={[
              {
                key: 'items',
                label: 'Items',
                value: '240',
                tone: 'info',
                icon: <Icon name="list" size={14} />,
              },
              {
                key: 'done',
                label: 'Completed',
                value: '237',
                tone: 'success',
                icon: <Icon name="check" size={14} />,
                trend: { delta: 0.042, verdict: 'good', label: '+4.2 pts' },
              },
              {
                key: 'errors',
                label: 'Errors',
                value: '20',
                tone: 'danger',
                icon: <Icon name="warning" size={14} />,
                onPress: () => setStat((s) => (s === 'errors' ? null : 'errors')),
                isSelected: stat === 'errors',
              },
              {
                key: 'nr',
                label: 'Not received',
                value: '3',
                tone: 'warning',
                icon: <Icon name="clock" size={14} />,
                trend: { delta: 0, verdict: 'flat', label: 'within noise' },
              },
            ]}
          />
        </Case>
        <Case label="KeyValueGrid tiles (config / metadata)" wide>
          <KeyValueGrid
            variant="tiles"
            columns={3}
            items={[
              { key: 'temp', label: 'Temperature', value: '0.2', mono: true, kind: 'config' },
              { key: 'tokens', label: 'Max tokens', value: '512', mono: true, kind: 'config' },
              { key: 'name', label: 'Run name', value: 'classic-rag-eval', mono: true, kind: 'metadata' },
              { key: 'owner', label: 'Owner', value: 'Dev User', icon: <Icon name="user" size={12} /> },
            ]}
          />
        </Case>
        <Case label="Trace kind icons">
          <Stack direction="row" gap="md">
            <Icon name="brain" size={16} title="LLM" />
            <Icon name="wrench" size={16} title="Tool" />
            <Icon name="search" size={16} title="Retrieval" />
            <Icon name="bot" size={16} title="Agent" />
            <Icon name="target" size={16} title="Evaluator" />
          </Stack>
        </Case>
        <Case label="Chart marks (hover dims siblings, tooltip, select)" wide>
          <ChartTooltipHost>
            <Stack direction="row" gap="xs" data-testid="gallery-marks">
              {[40, 70, 55, 90, 30].map((h, i) => (
                <Mark
                  key={i}
                  as="button"
                  band={(i + 1) as 1 | 2 | 3 | 4 | 5}
                  tip={`Bucket ${i + 1}: ${h} items`}
                  aria-label={`Bucket ${i + 1}: ${h} items`}
                  isSelected={mark === i}
                  onPick={() => setMark(mark === i ? null : i)}
                  style={{ width: 40, height: h, border: 0, background: `var(--score-${i + 1})` }}
                />
              ))}
            </Stack>
          </ChartTooltipHost>
        </Case>
        <Case label="Series cross-highlight (hover a swatch)" wide>
          <SeriesHighlightRoot>
            <Stack direction="row" gap="xs">
              {SERIES.map((n) => (
                <SeriesDot key={n} n={n} />
              ))}
            </Stack>
          </SeriesHighlightRoot>
        </Case>
      </div>
    </section>
  );
}
