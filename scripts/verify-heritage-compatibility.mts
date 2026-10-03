import assert from 'node:assert/strict';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { emptySnapshot, type Catalog, type CatalogEntry } from '../packages/contracts/src/index.js';
import type { HeritageProject } from '../packages/contracts/src/heritage.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import {
  acceptsCatalogVersion,
  assertAdditiveCatalogCompatibility,
  deduplicateHeritageProjects,
  heritageProgress,
  heritageLocationIsReferenceOnly,
  validateHeritageProjects,
} from '../packages/domain/src/heritage.js';

// Entirely synthetic fixtures: no personal records or downloaded catalogue are read.
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const entry = (number: number, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: id(number),
  recordId: id(number),
  scope: 'japan',
  regionIds: [id(1)],
  categoryId: 'heritage',
  name: `Synthetic place ${number}`,
  aliases: [],
  subitems: [],
  ...extra,
});
const previous: Catalog = {
  version: 'synthetic-v1',
  categories: [{ id: 'heritage', name: 'Heritage' }],
  regions: [
    {
      id: id(1),
      parentId: null,
      scope: 'japan',
      level: 1,
      name: 'Synthetic region',
      code: 'SYN',
      historical: false,
      aliases: [],
    },
  ],
  entries: [
    entry(2),
    entry(3, { subitems: [{ id: id(8), name: 'Existing named building' }] }),
    entry(7),
  ],
  achievements: { definitions: [], quantityRegionIds: [] },
  sources: [],
};
const next = {
  ...structuredClone(previous),
  version: 'synthetic-v2',
  compatibleCatalogVersions: [previous.version],
  entries: [...structuredClone(previous.entries), entry(4, { recordId: id(3) }), entry(5)],
};
const project: HeritageProject = {
  unescoId: '688',
  name: 'Synthetic serial property',
  sourceUrl: 'https://whc.unesco.org/en/list/688/',
  checkedAt: '2026-10-02',
  coverage: 'complete',
  expectedComponentCount: 2,
  componentEntryIds: [id(4), id(5)],
  legacyEntryIds: [id(2)],
  countryCodes: ['JPN'],
};
assertAdditiveCatalogCompatibility(previous, next);
validateHeritageProjects(next, [project]);
assert.equal(acceptsCatalogVersion(next, 'never-reviewed'), false);
assert.throws(() =>
  assertAdditiveCatalogCompatibility(previous, { ...next, compatibleCatalogVersions: [] }),
);
for (const mutation of [
  (catalog: typeof next) => {
    catalog.entries = catalog.entries.filter((item) => item.id !== id(7));
  },
  (catalog: typeof next) => {
    catalog.entries.find((item) => item.id === id(3))!.subitems = [];
  },
  (catalog: typeof next) => {
    catalog.entries.find((item) => item.id === id(2))!.recordId = id(5);
  },
  (catalog: typeof next) => {
    catalog.regions[0]!.parentId = id(99);
  },
]) {
  const broken = structuredClone(next);
  mutation(broken);
  assert.throws(() => assertAdditiveCatalogCompatibility(previous, broken));
}

const oldSnapshot = emptySnapshot(previous.version);
oldSnapshot.entries[id(2)] = {
  visited: true,
  subitemIds: [],
  note: 'Legacy project visit, no component evidence',
};
oldSnapshot.entries[id(3)] = { visited: false, subitemIds: [], note: 'Existing place note' };
oldSnapshot.regions[id(1)] = 'arrived';
const untouched = structuredClone(oldSnapshot);
const session = new HandbookSession(new CatalogIndex(next), oldSnapshot);
assert.deepEqual(oldSnapshot, untouched, 'Import must not mutate caller-owned snapshots');
assert.deepEqual(
  session.snapshot().entries,
  oldSnapshot.entries,
  'Migration must preserve old records verbatim',
);
assert.deepEqual(session.snapshot().regions, oldSnapshot.regions);
assert.equal(
  session.snapshot().catalogVersion,
  next.version,
  'Validated old records adopt the current catalogue version',
);
assert.deepEqual(heritageProgress(session, project), {
  legacyVisited: true,
  visitedComponents: 0,
  totalComponents: 2,
  availableComponents: 2,
  complete: false,
});

session.transaction(() => session.markSubitem(id(3), id(8), true));
assert.equal(
  heritageProgress(session, project).visitedComponents,
  1,
  'An existing same-place record genuinely updates its component alias',
);
session.transaction(() => session.markEntry(id(5), true));
assert.equal(heritageProgress(session, project).complete, true);
assert.equal(heritageProgress(session, { ...project, coverage: 'partial' }).complete, false);
assert.equal(heritageProgress(session, { ...project, expectedComponentCount: 3 }).complete, false);
assert.equal(
  heritageProgress(session, { ...project, componentEntryIds: [id(2), id(5)] }).visitedComponents,
  1,
  'Even malformed aliases cannot inherit the old project visit',
);
assert.throws(() =>
  validateHeritageProjects(next, [{ ...project, componentEntryIds: [id(2), id(5)] }]),
);
assert.throws(() => validateHeritageProjects(next, [{ ...project, expectedComponentCount: 3 }]));
const serialized = JSON.parse(JSON.stringify(session.snapshot()));
const restored = new HandbookSession(new CatalogIndex(next), serialized);
assert.equal(
  heritageProgress(restored, project).complete,
  true,
  'Component records survive export/import',
);
session.undo();
assert.equal(heritageProgress(session, project).visitedComponents, 1);
session.undo();
assert.equal(heritageProgress(session, project).visitedComponents, 0);
assert.equal(heritageProgress(session, project).legacyVisited, true);
assert.deepEqual(
  session.snapshot().entries,
  oldSnapshot.entries,
  'Undo restores retained project notes and visits',
);
assert.equal(session.snapshot().revision, 4, 'Undo preserves monotonically increasing revisions');
assert.throws(
  () => new HandbookSession(new CatalogIndex(next), { ...oldSnapshot, catalogVersion: 'unknown' }),
);
assert.throws(
  () =>
    new HandbookSession(new CatalogIndex(next), {
      ...oldSnapshot,
      entries: { ...oldSnapshot.entries, [id(99)]: { visited: true, subitemIds: [] } },
    }),
  'An admitted catalogue version must still reject unknown record IDs',
);
assert.throws(
  () =>
    new HandbookSession(new CatalogIndex(next), {
      ...oldSnapshot,
      entries: { ...oldSnapshot.entries, [id(3)]: { visited: true, subitemIds: [id(99)] } },
    }),
  'An admitted catalogue version must still reject unknown subitems',
);

const otherCountry = {
  ...structuredClone(project),
  countryCodes: ['FRA'],
  legacyEntryIds: [id(7)],
};
const merged = deduplicateHeritageProjects([project, otherCountry]);
assert.equal(merged.length, 1, 'Cross-country property references share one UNESCO parent');
assert.deepEqual(merged[0]!.componentEntryIds, [id(4), id(5)]);
assert.deepEqual(merged[0]!.legacyEntryIds, [id(2), id(7)]);
assert.deepEqual(merged[0]!.countryCodes, ['JPN', 'FRA']);
assert.deepEqual(project.legacyEntryIds, [id(2)], 'Dedupe does not mutate source data');
assert.throws(() =>
  deduplicateHeritageProjects([project, { ...otherCountry, expectedComponentCount: 3 }]),
);
assert.equal(
  deduplicateHeritageProjects([
    { ...project, coverage: 'partial', componentEntryIds: [id(4)] },
    { ...project, coverage: 'partial', componentEntryIds: [id(5)] },
  ])[0]!.coverage,
  'partial',
  'Union of partial country lists does not prove global completeness',
);

console.log(
  'PASS: additive catalogue safeguards; legacy snapshot import; independent component visits; shared place records; undo and round-trip; unknown records rejected; UNESCO parent deduplication; conservative coverage.',
);

// A formerly combined unit is replaced by two actual places, while its old record survives.
const expanded: Catalog = {
  ...structuredClone(next),
  version: 'synthetic-v3',
  compatibleCatalogVersions: [previous.version, next.version],
  entries: [
    ...next.entries.map((item) =>
      item.id === id(4) ? { ...item, officialComponentId: 'A' } : item,
    ),
    entry(9, { officialComponentId: 'AR01', parentComponentKey: 'old-combined-unit' }),
    entry(10, { officialComponentId: 'AR01', parentComponentKey: 'old-combined-unit' }),
  ],
};
const expandedProject: HeritageProject = {
  ...project,
  componentEntryIds: [id(4), id(9), id(10)],
  legacyEntryIds: [id(2), id(5)],
  expectedComponentCount: 2,
  applicationPlaceCount: 3,
  officialComponentGroups: [
    { officialComponentId: 'A', componentEntryIds: [id(4)] },
    { officialComponentId: 'AR01', componentEntryIds: [id(9), id(10)] },
  ],
};
assertAdditiveCatalogCompatibility(next, expanded);
validateHeritageProjects(expanded, [expandedProject]);
const beforeSplit = emptySnapshot(next.version);
beforeSplit.entries[id(5)] = {
  visited: true,
  subitemIds: [],
  note: 'Old combined cemetery record',
};
const splitSession = new HandbookSession(new CatalogIndex(expanded), beforeSplit);
assert.deepEqual(heritageProgress(splitSession, expandedProject), {
  legacyVisited: true,
  visitedComponents: 0,
  totalComponents: 3,
  availableComponents: 3,
  visitedOfficialComponents: 0,
  totalOfficialComponents: 2,
  availableOfficialComponents: 2,
  complete: false,
});
splitSession.transaction(() => splitSession.markEntry(id(9), true));
assert.equal(heritageProgress(splitSession, expandedProject).visitedOfficialComponents, 0);
splitSession.transaction(() => splitSession.markEntry(id(10), true));
assert.equal(heritageProgress(splitSession, expandedProject).visitedOfficialComponents, 1);
assert.equal(heritageProgress(splitSession, expandedProject).complete, false);
splitSession.transaction(() => splitSession.markEntry(id(4), true));
assert.equal(heritageProgress(splitSession, expandedProject).complete, true);
assert.equal(
  heritageProgress(splitSession, { ...expandedProject, coverage: 'partial' }).complete,
  false,
);
const splitRestored = new HandbookSession(
  new CatalogIndex(expanded),
  JSON.parse(JSON.stringify(splitSession.snapshot())),
);
assert.equal(heritageProgress(splitRestored, expandedProject).visitedOfficialComponents, 2);
splitSession.undo();
splitSession.undo();
splitSession.undo();
assert.deepEqual(splitSession.snapshot().entries, beforeSplit.entries);
assert.equal(heritageProgress(splitSession, expandedProject).visitedComponents, 0);
for (const mutate of [
  (item: HeritageProject) => {
    item.applicationPlaceCount = 2;
  },
  (item: HeritageProject) => {
    item.officialComponentGroups![1]!.componentEntryIds.pop();
  },
  (item: HeritageProject) => {
    item.officialComponentGroups![1]!.componentEntryIds.push(id(4));
  },
  (item: HeritageProject) => {
    item.officialComponentGroups![1]!.officialComponentId = 'wrong-id';
  },
  (item: HeritageProject) => {
    item.expectedComponentCount = 1;
  },
]) {
  const broken = structuredClone(expandedProject);
  mutate(broken);
  assert.throws(() => validateHeritageProjects(expanded, [broken]));
}
const splitMerged = deduplicateHeritageProjects([
  expandedProject,
  structuredClone(expandedProject),
])[0]!;
validateHeritageProjects(expanded, [splitMerged]);
assert.equal(splitMerged.applicationPlaceCount, 3);
assert.equal(splitMerged.officialComponentGroups![1]!.componentEntryIds.length, 2);

assert.equal(
  heritageLocationIsReferenceOnly({
    ordinaryPointEligible: false,
    coordinateRole: 'area-reference',
  }),
  true,
);
assert.equal(
  heritageLocationIsReferenceOnly({
    ordinaryPointEligible: true,
    coordinateRole: 'area-reference',
  }),
  true,
);
assert.equal(
  heritageLocationIsReferenceOnly({
    coordinateStatus: 'official-shared-representative-coordinate',
  }),
  true,
);
assert.equal(
  heritageLocationIsReferenceOnly({ unitKind: 'official-project-geographical-row' }),
  true,
);
assert.equal(
  heritageLocationIsReferenceOnly(
    { coordinateStatus: 'official-geographical-data' },
    { coordinateReferenceOnly: true },
  ),
  true,
);
assert.equal(
  heritageLocationIsReferenceOnly({
    ordinaryPointEligible: true,
    coordinateRole: 'place-reference',
    coordinateStatus: 'official-national-heritage-place-coordinate',
  }),
  false,
);
console.log(
  'PASS: official groups vs application places; combined-record split preserves visits without propagation; round-trip/undo; malformed groups rejected; area/shared/project coordinates suppressed.',
);
