/**
 * Status rules guards (owner decision 2026-11-12, DESIGN_LANGUAGE §3.3 "Which style shows a state").
 * A step of a process is a StatusMark. A condition or a check result is a StateTag. An on/off exception is a grey
 * Flag. A save state is plain text. Static scans of src/**, in the style of design-language-v3.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(p, 'utf-8');
const rel = (p: string) => relative(SRC, p).split('\\').join('/');
const all = fg.sync('**/*.{ts,tsx}', { cwd: SRC, absolute: true, ignore: ['**/node_modules/**'] });
const shipped = all.filter(
  (f) => !/__tests__\/|\.test\.tsx?$|\.stories\.tsx?$/.test(rel(f)) && !rel(f).startsWith('features/dev/'),
);
const src = (p: string) => read(join(SRC, p));

function grep(files: string[], re: RegExp): string[] {
  const out: string[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(g)) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push(`${rel(f)}:${line}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  return out;
}
const none = (list: string[], why: string) => expect(list, [why, ...list].join('\n')).toEqual([]);

/** Places that show only a condition, a result, an on/off exception or a save state: no status mark at all. */
const NO_STATUS_MARK = [
  'features/admin/feedback/FeedbackAgentTab.tsx',
  'features/admin/projects/ProjectsTable.tsx',
  'features/admin/users/UsersTable.tsx',
  'features/analyzer/guidance/DiagnosisPanel.tsx',
  'features/compare/components/items/OutputCard.tsx',
  'features/compare/components/sweep/SweepView.tsx',
  'features/datasets/compare/DatasetComparePage.tsx',
  'features/datasets/detail/ItemPane.tsx',
  'features/datasets/detail/ItemsTab.tsx',
  'features/environments/EnvironmentSections.tsx',
  'features/environments/EnvironmentsList.tsx',
  'features/experiments/detail/Credentials.tsx',
  'features/experiments/launch/entry/EnvironmentPicker.tsx',
  'features/experiments/launch/review/ReviewParts.tsx',
  'features/live/components/Canaries.tsx',
  'features/live/components/DaysTable.tsx',
  'features/live/components/StatusLine.tsx',
  'features/live/components/TurnsTable.tsx',
  'features/live/components/turn/AnswerSqlTab.tsx',
  'features/live/components/turn/ChartsTab.tsx',
  'features/live/components/turn/ConversationTab.tsx',
  'features/live/components/turn/DiagnosisTab.tsx',
  'features/live/components/turn/EvaluatorTab.tsx',
  'features/live/components/turn/JudgesTab.tsx',
  'features/live/components/turn/ServicesTab.tsx',
  'features/live/components/turn/TurnHeader.tsx',
  'features/live/components/turn/TurnTiles.tsx',
  'features/live/components/worker/HistoryBlock.tsx',
  'features/live/components/worker/ProblemsBlock.tsx',
  'features/live/components/worker/SettingsForm.tsx',
  'features/live/components/worker/StatusStrip.tsx',
  'features/run-detail/components/items/ItemBar.tsx',
  'features/run-detail/components/items/ItemsTable.tsx',
  'features/run-detail/components/items/OutputRegion.tsx',
  'features/run-detail/components/traces/SpanDetail.tsx',
  'features/shell/chrome/CommandPalette.tsx',
  'features/shell/chrome/ProjectSwitcher.tsx',
  'features/shell/settings/ApiKeysTab.tsx',
  'features/shell/settings/ProjectSettingsPage.tsx',
  'sdk-viewer/App.tsx',
  'sdk-viewer/components/Detail.tsx',
  'sdk-viewer/components/RowList.tsx',
];

describe('status rules (2026-11-12)', () => {
  it('S-01: StateTag is the tinted state Tag, with the five tones', () => {
    const t = src('ui/Tag/StateTag.tsx');
    expect(t).toContain('kind="state"');
    expect(t).toMatch(/'info' \| 'success' \| 'warning' \| 'danger' \| 'neutral'/);
    expect(src('ui/Tag/index.ts')).toContain('StateTag');
  });

  it('S-02: a condition, a result, an on/off state or a save state is never a status mark', () => {
    const hits = NO_STATUS_MARK.flatMap((p) =>
      /<(StatusMark|RunStatusBadge|ReviewStatusMark)\b/.test(src(p)) ? [p] : [],
    );
    none(
      hits,
      'These places show a health, a result, an on/off state or a save state: use StateTag, Flag or text.',
    );
  });

  it('S-03: blue means working now: an info status mark is always the orbit', () => {
    none(
      grep(shipped, /\[\s*'info',\s*'(full|check|cross|ring|pause|hourglass|dot)'/),
      'An info StatusMark map entry must use the orbit figure.',
    );
    none(
      grep(shipped, /<StatusMark[^>]*tone="info"[^>]*shape="(?!orbit)\w+"/s),
      'An info StatusMark must use the orbit figure.',
    );
  });

  it('S-04: a released version that is not in use shows no mark; Production is the green star Flag', () => {
    none(grep(shipped, /label="Published"/), 'A released version that is not in use shows nothing.');
    for (const p of [
      'features/analyzer/guidance/RulesPanel.tsx',
      'features/datasets/components/VersionSwitcher.tsx',
    ]) {
      expect(src(p), p).toMatch(/<Flag tone="success" icon="star">\s*Production/);
      expect(src(p), p).not.toMatch(/label="Production"/);
    }
  });

  it('S-05: an on/off exception is a grey Flag with the archive or ban glyph, never a status mark', () => {
    none(
      grep(shipped, /<StatusMark[^>]*label="(Archived|Project archived|Disabled|Revoked)"/s),
      'Archived, Disabled and Revoked are grey Flags.',
    );
    none(
      grep(
        shipped,
        /<Flag[^>]*tone="(warning|danger|info|success)"[^>]*>\s*(Archived|Project archived|Disabled|Revoked)\b/s,
      ),
      'Archived, Disabled and Revoked are grey (no tone).',
    );
  });

  it('S-06: the word Running in a state tag is always blue', () => {
    none(
      grep(shipped, /<StateTag tone="(success|warning|danger|neutral)"[^>]*>\s*Running/s),
      'Running is the info (blue) StateTag.',
    );
  });

  it('S-07: one word, one meaning: a review waits as Awaiting review', () => {
    expect(src('ui/StatusMark/ReviewStatusMark.tsx')).not.toMatch(/label[:=]\s*['"]Pending['"]/);
    expect(src('ui/StatusMark/ReviewStatusMark.tsx')).toContain('Awaiting review');
  });
});
