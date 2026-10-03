import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  emptySnapshot,
  type Catalog,
  type RecordSnapshot,
} from '../packages/contracts/src/index.js';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import { achievementProgress } from '../packages/domain/src/achievements.js';

const fixturePath = 'data/fixtures/chancellor-baseline-v0.7.0.json';
const fixtureBytes = readFileSync(fixturePath);
const baseline = JSON.parse(fixtureBytes.toString('utf8')) as {
  format: string;
  version: number;
  catalogVersion: string;
  provenance: { sourceCommit: string; sourceCatalogSha256: string };
  counts: { entries: number; regions: number; otherAchievements: number };
  hashes: { entries: string; regions: string; otherDefinitions: string; quantityRegionIds: string };
  originalAchievement: Catalog['achievements']['definitions'][number];
};
// Array order is meaningful; only object-property insertion order is normalized.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonical(object[key])]),
    );
  }
  return value;
}
const normalizedHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const file = 'data/catalog/catalog.json';
const bytes = readFileSync(file);
const catalog = JSON.parse(bytes.toString('utf8')) as Catalog;
const id = 'theme-chancellor';
const original = baseline.originalAchievement;
const current = catalog.achievements.definitions.find((a) => a.id === id)!;
assert.equal(baseline.format, 'fangyu-chancellor-baseline');
assert.equal(baseline.version, 1);
assert(original && current);
assert.equal(original.id, id);
assert.equal(baseline.catalogVersion, '2026-10-03.15');
assert.equal(catalog.version, '2026-10-03.16');
assert(catalog.compatibleCatalogVersions?.includes(baseline.catalogVersion));
assert.equal(catalog.entries.length, baseline.counts.entries);
assert.equal(catalog.regions.length, baseline.counts.regions);
assert.equal(catalog.achievements.definitions.length - 1, baseline.counts.otherAchievements);
assert.equal(
  normalizedHash(catalog.entries),
  baseline.hashes.entries,
  'No entry, coordinate, ID or record ID changes',
);
assert.equal(
  normalizedHash(catalog.regions),
  baseline.hashes.regions,
  'No administrative region changes',
);
assert.equal(
  normalizedHash(catalog.achievements.quantityRegionIds),
  baseline.hashes.quantityRegionIds,
);
assert.equal(
  normalizedHash(catalog.achievements.definitions.filter((a) => a.id !== id)),
  baseline.hashes.otherDefinitions,
  'All other achievements remain unchanged',
);
assert.equal(original.targets.length, 4);
assert.deepEqual(
  current.targets.slice(0, 4),
  original.targets,
  'Original four targets are preserved exactly',
);
assert.equal(current.targets.length, 8);
assert.equal(current.need, 8);
const {
  note: _oldNote,
  sources: _oldSources,
  need: _oldNeed,
  targets: _oldTargets,
  ...oldRest
} = original;
const {
  note: _newNote,
  sources: _newSources,
  need: _newNeed,
  targets: _newTargets,
  ...newRest
} = current;
assert.deepEqual(newRest, oldRest, 'No unrelated achievement metadata changes');
assert.match(current.note, /眉县具体祠庙待核/);
assert.match(current.note, /不以岐山县/);
assert.match(current.note, /不代表具体祠庙已到访/);

// Independent fixed administrative codes, not copied from the integration proposal.
const expected = [
  { code: '610326', name: '眉县', parentCode: '610300' },
  { code: '530502', name: '隆阳区', parentCode: '530500' },
  { code: '621226', name: '礼县', parentCode: '621200' },
  { code: '500236', name: '奉节县', parentCode: '500000' },
];
const index = new CatalogIndex(catalog);
const regionByCode = (code: string) => {
  const matches = catalog.regions.filter(
    (r) => r.scope === 'china' && r.code === code && !r.historical,
  );
  assert.equal(matches.length, 1, `Unique current Chinese region ${code}`);
  return matches[0]!;
};
const added = expected.map((spec, i) => {
  const region = regionByCode(spec.code);
  assert.equal(region.name, spec.name);
  assert.equal(region.level, 2);
  assert.equal(index.regions.get(region.parentId!)?.code, spec.parentCode);
  assert.deepEqual(current.targets[i + 4]!.regionIds, [region.id]);
  assert.deepEqual(
    current.targets[i + 4]!.condition,
    { mode: 'any', regionIds: [region.id] },
    'New county requires its own record, not ancestor inference or an entry',
  );
  return region;
});
const allIds = current.targets.flatMap((t) => t.regionIds);
assert.equal(new Set(allIds).size, allIds.length, 'No duplicated region across eight targets');
const oldCounties = original.targets.map((t) => {
  const region = index.regions.get(t.regionIds[0]!)!;
  assert.equal(region.level, 2);
  return region;
});
const progress = (session: HandbookSession) => {
  const before = session.snapshot();
  const result = achievementProgress(session).find((a) => a.id === id)!;
  assert.deepEqual(
    session.snapshot(),
    before,
    'Achievement calculation cannot modify user records',
  );
  return result;
};
const assertCount = (session: HandbookSession, count: number) => {
  const result = progress(session);
  assert.equal(result.count, count);
  assert.equal(result.total, 8);
  assert.equal(result.need, 8);
  assert.equal(result.complete, count === 8);
  assert.equal(result.lit, count === 8);
  return result;
};
const session = new HandbookSession(index);
assertCount(session, 0);
for (const region of oldCounties)
  session.transaction(() => session.setRegionState(region.id, 'arrived', false));
assertCount(session, 4);
assert.deepEqual(
  progress(session).targets.map((t) => t.visited),
  [true, true, true, true, false, false, false, false],
);
for (const [i, region] of added.entries()) {
  session.transaction(() => session.setRegionState(region.id, 'arrived', false));
  assertCount(session, 5 + i);
}
assert.deepEqual(
  session.snapshot().entries,
  {},
  'County achievement never requires or manufactures temple visits',
);
const completed = session.snapshot();
session.transaction(() => session.setRegionState(added[0]!.id, 'unvisited', false));
assertCount(session, 7);
session.undo();
assertCount(session, 8);
assert.deepEqual(session.snapshot().regions, completed.regions);
session.transaction(() => {
  for (const region of added) session.setRegionState(region.id, 'unvisited', false);
});
assertCount(session, 4);
session.undo();
assertCount(session, 8);

const substitutions = new HandbookSession(index);
for (const county of added) {
  substitutions.transaction(() =>
    substitutions.setRegionState(county.parentId!, 'resident', false),
  );
  assertCount(substitutions, 0);
}
const qishan = regionByCode('610323');
assert.equal(qishan.name, '岐山县');
substitutions.transaction(() => substitutions.setRegionState(qishan.id, 'resident'));
assertCount(substitutions, 0);
assert.equal(
  progress(substitutions).targets[4]!.visited,
  false,
  'Baoji and neighboring Qishan cannot replace Meixian',
);
substitutions.transaction(() => substitutions.setRegionState(added[0]!.id, 'transit', false));
assertCount(substitutions, 0);
substitutions.transaction(() => substitutions.setRegionState(added[0]!.id, 'arrived', false));
assertCount(substitutions, 1);
substitutions.transaction(() => substitutions.setRegionState(added[0]!.id, 'unvisited', false));
assertCount(substitutions, 0);

// Synthetic old-format data only: no browser storage or personal records are read.
const legacy: RecordSnapshot = emptySnapshot(baseline.catalogVersion);
legacy.revision = 42;
legacy.updatedAt = '2026-10-02T10:00:00.000Z';
for (const region of oldCounties) legacy.regions[region.id] = 'arrived';
const entry = catalog.entries.find((e) => e.id === e.recordId && e.subitems.length > 0)!;
assert(entry);
legacy.entries[entry.recordId] = {
  visited: false,
  subitemIds: [entry.subitems[0]!.id],
  name: 'Synthetic personal name 自定义名称',
  note: 'Synthetic note\n保留换行与备注',
};
const customId = 'acd09485-7f90-4539-8b2c-569e2f24c010';
const subitemId = 'acd09485-7f90-4539-8b2c-569e2f24c011';
legacy.customEntries.push({
  id: customId,
  recordId: customId,
  scope: 'china',
  regionIds: [oldCounties[0]!.id],
  categoryId: 'airport',
  name: 'Synthetic custom place',
  aliases: ['自定义别名'],
  subitems: [{ id: subitemId, name: 'Synthetic part' }],
});
legacy.entries[customId] = {
  visited: true,
  subitemIds: [subitemId],
  name: 'Personal custom label',
  note: 'Custom note retained',
};
legacy.preferences = {
  palette: 'ink',
  mapLevel: 'county',
  mapLayers: { visitedAirports: true, visitedWorldHeritage: false },
};
const untouched = structuredClone(legacy);
// Entries, regions and other definitions above match the .15 fixture hashes.
// Reconstruct only the old achievement/version in memory; no old Git object is needed.
const oldCatalog: Catalog = {
  ...catalog,
  version: baseline.catalogVersion,
  achievements: {
    ...catalog.achievements,
    definitions: catalog.achievements.definitions.map((a) => (a.id === id ? original : a)),
  },
};
const oldSession = new HandbookSession(new CatalogIndex(oldCatalog), legacy);
assert.equal(achievementProgress(oldSession).find((a) => a.id === id)!.count, 4);
const migrated = new HandbookSession(index, legacy);
assert.deepEqual(legacy, untouched, 'Import must not mutate the input object');
assert.deepEqual(
  migrated.snapshot(),
  { ...legacy, catalogVersion: catalog.version },
  'Only catalog version migrates; all old records and customizations survive',
);
assertCount(migrated, 4);
assert.equal(migrated.view(migrated.entry(entry.id)).name, legacy.entries[entry.recordId]!.name);
const roundtrip = new HandbookSession(index, JSON.parse(JSON.stringify(migrated.snapshot())));
assert.deepEqual(roundtrip.snapshot(), migrated.snapshot());
roundtrip.transaction(() => {
  for (const region of added) roundtrip.setRegionState(region.id, 'arrived', false);
});
assertCount(roundtrip, 8);
roundtrip.undo();
assertCount(roundtrip, 4);
for (const key of ['entries', 'customEntries', 'regions', 'preferences'] as const)
  assert.deepEqual(roundtrip.snapshot()[key], migrated.snapshot()[key]);
assert.equal(
  roundtrip.snapshot().version,
  1,
  'Achievement changes do not upgrade the record format',
);
assert.deepEqual(readFileSync(file), bytes, 'Test never writes the catalog');
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const result = {
  passed: true,
  baselineFixture: fixturePath,
  baselineFixtureSha256: sha(fixtureBytes),
  baselineSourceCommit: baseline.provenance.sourceCommit,
  baselineVersion: baseline.catalogVersion,
  catalogVersion: catalog.version,
  baselineCatalogSha256: baseline.provenance.sourceCatalogSha256,
  catalogSha256: sha(bytes),
  preserved: {
    entries: baseline.counts.entries,
    regions: baseline.counts.regions,
    otherAchievements: baseline.counts.otherAchievements,
    originalTargets: 4,
  },
  addedCounties: added.map((r) => ({ id: r.id, code: r.code, name: r.name })),
  checks: [
    'unchanged entries/coordinates/regions/other achievements',
    'original four targets deep equal',
    'four unique exact counties with own-record conditions',
    '0/8 -> 4/8 -> 5/8 -> 6/8 -> 7/8 -> 8/8',
    'clear one/all new targets and undo',
    'parent city and Qishan cannot substitute for Meixian',
    'transit does not count as arrival',
    '.15 synthetic snapshot migrates only catalogVersion',
    'custom names/notes/aliases/subitems/preferences and original records survive roundtrip and undo',
    'read-only progress and catalog',
  ],
};
mkdirSync('data/generated/chancellor-targets', { recursive: true });
writeFileSync(
  'data/generated/chancellor-targets/verification.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
