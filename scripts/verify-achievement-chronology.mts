import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Catalog } from '../packages/contracts/src/index.js';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import { achievementProgress } from '../packages/domain/src/achievements.js';
import {
  ACHIEVEMENT_CHRONOLOGY,
  achievementChronology,
  compareAchievementChronology,
  sortHistoricalAchievements,
  type AchievementChronology,
} from '../packages/domain/src/achievement-chronology.js';
const bytes = readFileSync('data/catalog/catalog.json');
const catalog = JSON.parse(bytes.toString('utf8')) as Catalog;
const before = JSON.stringify(catalog.achievements);
const history = catalog.achievements.definitions.filter((a) => a.section === 'history');
assert.equal(history.length, 24);
assert.deepEqual(
  new Set(Object.keys(ACHIEVEMENT_CHRONOLOGY)),
  new Set(history.map((a) => a.id)),
  'Every present historical achievement has explicit chronology or a disclosed unresolved reason',
);
for (const [id, c] of Object.entries(ACHIEVEMENT_CHRONOLOGY)) {
  assert(c.label && c.basis, id);
  if (c.kind === 'dated') {
    assert(Number.isInteger(c.startYear) && c.startYear !== 0, id);
    assert(Number.isInteger(c.endYear) && c.endYear !== 0, id);
    assert(c.startYear! <= c.endYear!, id);
    assert(c.sources.length, id);
  } else assert.equal(c.startYear, undefined, 'No fabricated numeric year for legends/unknowns');
  for (const source of c.sources) assert(/^https:\/\//.test(source.url));
}
const era = (startYear: number, endYear = startYear): AchievementChronology => ({
  kind: 'dated',
  label: 'Synthetic era',
  startYear,
  endYear,
  basis: 'Test',
  sources: [],
});
assert(
  compareAchievementChronology(era(-475, -221), era(-221, -207)) < 0,
  'BCE years are chronological, not absolute magnitudes',
);
assert(compareAchievementChronology(era(-1), era(1)) < 0, 'BCE precedes CE without a year zero');
assert(
  compareAchievementChronology(era(200, 222), era(200, 234)) < 0,
  'Equal starts sort by end year',
);
assert.equal(compareAchievementChronology(era(1935), era(1935)), 0);
const sorted = sortHistoricalAchievements(catalog.achievements.definitions);
assert.equal(
  JSON.stringify(catalog.achievements),
  before,
  'Original catalog/targets/IDs remain byte-equivalent in memory',
);
assert.equal(sorted.length, catalog.achievements.definitions.length);
assert.deepEqual(
  new Set(sorted),
  new Set(catalog.achievements.definitions),
  'Only object order changes',
);
for (let i = 0; i < sorted.length; i++)
  if (catalog.achievements.definitions[i]!.section !== 'history')
    assert.equal(sorted[i], catalog.achievements.definitions[i]);
const ordered = sorted.filter((a) => a.section === 'history').map((a) => a.id);
const earlier = (a: string, b: string) =>
  assert(ordered.indexOf(a) < ordered.indexOf(b), `${a} before ${b}`);
earlier('theme-yu', 'theme-shang');
earlier('theme-shang', 'theme-hegemons');
earlier('theme-hegemons', 'theme-seven');
earlier('theme-qin', 'theme-chu-han');
earlier('theme-chu-han', 'theme-rebellion');
earlier('theme-rebellion', 'theme-han103');
earlier('theme-grass', 'theme-tang');
earlier('theme-tang', 'theme-emei');
earlier('theme-emei', 'theme-yuyang');
earlier('theme-outlaws', 'theme-loushan');
earlier('theme-loushan', 'theme-liupan');
assert.equal(ordered.at(-1), 'theme-bamboo');
const missing = [
  { id: 'future-b', section: 'history', title: '商', unlockedAt: 0 },
  { id: 'theme-tang', section: 'history', title: 'renamed', unlockedAt: 999999 },
  { id: 'future-a', section: 'history', title: '上古', unlockedAt: 1 },
];
assert.deepEqual(
  sortHistoricalAchievements(missing).map((a) => a.id),
  ['theme-tang', 'future-b', 'future-a'],
  'Unknown titles are not parsed; unknowns retain catalog order; unlock time is ignored',
);
assert.equal(achievementChronology({ id: 'theme-tang', section: 'routes' }), undefined);
const session = new HandbookSession(new CatalogIndex(catalog));
const snapshot = session.snapshot();
const progress = achievementProgress(session);
assert.deepEqual(
  session.snapshot(),
  snapshot,
  'Computing chronological achievements does not mutate records',
);
assert.deepEqual(
  progress.filter((a) => a.section === 'history').map((a) => a.id),
  ordered,
  'The actual domain/worker path returns chronological history',
);
const modern = progress.find((a) => a.id === 'theme-loushan')!;
assert.equal(modern.complete, false);
session.transaction(() =>
  session.setRegionState(modern.targets[0]!.regionIds[0]!, 'arrived', false),
);
const afterVisit = achievementProgress(session);
assert(
  afterVisit.find((a) => a.id === 'theme-loushan')!.complete,
  'Synthetic recent event can unlock normally',
);
assert.deepEqual(
  afterVisit.filter((a) => a.section === 'history').map((a) => a.id),
  ordered,
  'Completion must not promote an achievement above earlier history',
);
session.undo();
assert.deepEqual(
  achievementProgress(session)
    .filter((a) => a.section === 'history')
    .map((a) => a.id),
  ordered,
  'Undo preserves chronological order',
);
assert.equal(achievementProgress(session).find((a) => a.id === 'theme-loushan')!.complete, false);
assert.equal(
  createHash('sha256').update(readFileSync('data/catalog/catalog.json')).digest('hex'),
  createHash('sha256').update(bytes).digest('hex'),
);
mkdirSync('data/generated/achievement-chronology', { recursive: true });
writeFileSync(
  'data/generated/achievement-chronology/verification.json',
  JSON.stringify(
    {
      status: 'pass',
      historicalCount: history.length,
      order: ordered.map((id) => ({ id, label: ACHIEVEMENT_CHRONOLOGY[id]!.label })),
      unresolved: history
        .filter((a) => achievementChronology(a)!.kind === 'undated')
        .map((a) => ({ id: a.id, reason: achievementChronology(a)!.basis })),
      checks: [
        'BCE/CE and start/end ranges',
        'equal year stability',
        'unknowns stable and no title inference',
        'non-history slots preserved',
        'actual domain worker order',
        'IDs/targets/catalog unchanged',
        'synthetic completion/undo order independence',
        'no record mutation during sort',
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'PASS chronological history: 24 IDs, BCE/CE/range ordering, unknowns, unrelated series, actual progress + completion/undo compatibility.',
);
