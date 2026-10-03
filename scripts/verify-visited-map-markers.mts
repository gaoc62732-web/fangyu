import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import {
  emptySnapshot,
  snapshotSchema,
  type Catalog,
  type CatalogEntry,
  type MapLayers,
} from '../packages/contracts/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import {
  visitedMapMarkers,
  type VerifiedVisitedMapAssociation,
} from '../packages/domain/src/visited-map-markers.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const all: MapLayers = { visitedAirports: true, visitedWorldHeritage: true };
const source = (n: number, maps = false) =>
  `https://whc.unesco.org/en/list/${n}/${maps ? 'maps/' : ''}`;
const catalog: Catalog = {
  version: 'overlay-test-v2',
  compatibleCatalogVersions: ['overlay-test-v1'],
  categories: [
    'airport',
    'world-heritage',
    'world-heritage-component',
    'world-heritage-legacy-component',
    'historic-site',
  ].map((id) => ({ id, name: id })),
  regions: [
    {
      id: id(1),
      parentId: null,
      scope: 'china',
      level: 0,
      name: 'Synthetic province',
      code: '100000',
      aliases: [],
      historical: false,
    },
    {
      id: id(2),
      parentId: id(1),
      scope: 'china',
      level: 1,
      name: 'Synthetic city',
      code: '100100',
      aliases: [],
      historical: false,
    },
    {
      id: id(3),
      parentId: null,
      scope: 'world',
      level: 1,
      name: 'China',
      code: 'CHN',
      aliases: [],
      historical: false,
    },
    {
      id: id(4),
      parentId: null,
      scope: 'world',
      level: 1,
      name: 'Japan',
      code: 'JPN',
      aliases: [],
      historical: false,
    },
    {
      id: id(5),
      parentId: id(4),
      scope: 'japan',
      level: 1,
      name: 'Synthetic prefecture',
      code: 'JP-01',
      aliases: [],
      historical: false,
    },
  ],
  entries: [],
  heritageProjects: [],
  achievements: { definitions: [], quantityRegionIds: [] },
  sources: [{ name: 'UNESCO DataHub', url: 'https://data.unesco.org/explore/assets/whc001/' }],
};
const entry = (n: number, extra: Partial<CatalogEntry> = {}) => {
  const row: CatalogEntry = {
    id: id(n),
    recordId: id(n),
    scope: 'china',
    regionIds: [id(2)],
    categoryId: 'airport',
    name: `Synthetic ${n}`,
    aliases: [],
    subitems: [],
    coordinates: [100, 30],
    ...extra,
  };
  catalog.entries.push(row);
  return row;
};
entry(10); // Native airport.
entry(11, { coordinates: null, name: 'PEK 合成机场' });
entry(12, { coordinates: [0, 0] }); // Equator/meridian are valid, not missing.
entry(13, { coordinates: [181, 0] });
entry(14, { scope: 'world', regionIds: [id(3)], countryCode: 'CHN' });
entry(15, { scope: 'world', regionIds: [id(4)], countryCode: 'JPN' });
entry(16, { scope: 'world', regionIds: [id(3)] }); // No explicit country code: no country-name inference.
entry(20, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '100',
  source: source(100),
});
entry(21, { categoryId: 'world-heritage', coordinates: null, name: 'Same heritage title' });
entry(22, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '101',
  source: source(101),
  name: 'Same heritage title',
});
entry(23, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '102',
  source: 'https://whc.unesco.org.evil.invalid/en/list/102/',
});
entry(24, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '103',
  source: source(103),
  ordinaryPointEligible: false,
});
entry(25, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '104',
  source: source(104),
  coordinates: null,
  coordinateStatus: 'retained-project-record-no-component-location',
});
entry(26, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '105',
  source: source(105),
  coordinateReferenceOnly: true,
});
entry(30, {
  categoryId: 'world-heritage-component',
  heritageProjectId: '106',
  source: source(106, true),
  coordinateRole: 'place-reference',
  ordinaryPointEligible: true,
});
entry(31, {
  categoryId: 'world-heritage-component',
  coordinateRole: 'area-reference',
  ordinaryPointEligible: false,
  coordinates: null,
  referenceCoordinates: [100, 30],
});
entry(32, { categoryId: 'world-heritage-component', heritageMembershipStatus: 'excluded' });
entry(33, {
  categoryId: 'world-heritage-legacy-component',
  heritageMembershipStatus: 'superseded',
});
entry(34, {
  categoryId: 'world-heritage-component',
  coordinateStatus: 'official-shared-representative-coordinate',
});
entry(35, { categoryId: 'world-heritage-component', coordinates: null });
entry(36, {
  categoryId: 'world-heritage-component',
  subitems: [{ id: id(136), name: 'Real marked subitem' }],
});
entry(40, { categoryId: 'historic-site' });
entry(41, { categoryId: 'world-heritage-component', recordId: id(40), heritageProjectId: '107' });
entry(42, { categoryId: 'world-heritage-component', recordId: id(40), heritageProjectId: '108' });
entry(43, {
  categoryId: 'world-heritage-component',
  recordId: id(40),
  scope: 'world',
  regionIds: [id(4)],
  countryCode: 'JPN',
  topicRegions: { japan: [id(5)] },
});
entry(44, { categoryId: 'historic-site' });
entry(45, { categoryId: 'world-heritage-component', recordId: id(44), coordinates: [100, 30] });
entry(46, { categoryId: 'world-heritage-component', recordId: id(44), coordinates: [101, 30] });
entry(50, {
  categoryId: 'world-heritage',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: '110',
  source: source(110),
  coordinates: null,
  coordinateStatus: 'retained-project-record-no-component-location',
});
entry(51, {
  categoryId: 'world-heritage-component',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  heritageProjectId: '110',
  unitKind: 'official-project-geographical-row',
  coordinates: null,
  referenceCoordinates: [111, 31],
  ordinaryPointEligible: false,
  coordinateRole: 'project-reference',
  coordinateStatus: 'official-project-representative-coordinate',
  coordinateSourceUrl: source(110, true),
});
entry(52, {
  categoryId: 'world-heritage-component',
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  heritageProjectId: '110',
  coordinates: [112, 32],
});
catalog.heritageProjects!.push({
  unescoId: '110',
  name: 'Synthetic project',
  sourceUrl: source(110),
  checkedAt: 'synthetic',
  coverage: 'partial',
  legacyEntryIds: [id(50)],
  componentEntryIds: [id(51), id(52)],
  countryCodes: ['CHN'],
});
entry(60, {
  scope: 'world',
  regionIds: [id(3)],
  countryCode: 'CHN',
  code: 'PEK',
  source: 'https://ourairports.com/airports/ZBAA/',
  coordinates: [116.6, 40.1],
});

const create = (visitedIds: number[], data = catalog) => {
  const snapshot = emptySnapshot(data.version);
  for (const n of visitedIds) snapshot.entries[id(n)] = { visited: true, subitemIds: [] };
  return new HandbookSession(new CatalogIndex(data), snapshot);
};
const select = (session: HandbookSession, extra = {}) =>
  visitedMapMarkers(session, { scope: 'china', layers: all, ...extra });
const airport = create([10, 11, 12, 13, 14, 15, 16]);
const beforeAirport = airport.snapshot();
assert.deepEqual(
  select(airport).markers.map((m) => m.recordId),
  [id(10), id(12), id(14)],
);
assert.equal(select(airport).counts.airports.omitted, 2);
assert.deepEqual(
  select(airport, { selectedRegionId: id(1) }).markers.map((m) => m.recordId),
  [id(10), id(12)],
);
assert.equal(
  visitedMapMarkers(airport, { scope: 'japan', layers: all }).markers[0]!.recordId,
  id(15),
);
assert.equal(
  visitedMapMarkers(airport, { scope: 'japan', selectedRegionId: id(5), layers: all }).markers
    .length,
  0,
  'A national-only record never borrows provincial attribution from coordinates',
);
assert.deepEqual(airport.snapshot(), beforeAirport, 'Selectors never mutate a snapshot');
assert.deepEqual(select(create([])).counts, {
  visitedRecords: 0,
  mappedRecords: 0,
  omittedRecords: 0,
  airports: { visited: 0, mapped: 0, omitted: 0 },
  worldHeritage: { visited: 0, mapped: 0, omitted: 0 },
  projectReferences: 0,
});
const parent = create([20, 21, 22, 23, 24, 25, 26, 50]);
const parents = select(parent);
assert.deepEqual(
  parents.markers.map((m) => m.recordId),
  [id(20), id(22), id(50)],
);
assert(parents.markers.every((m) => m.kind === 'project-reference'));
assert.deepEqual(parents.markers.find((m) => m.recordId === id(50))!.coordinates, [111, 31]);
assert(
  !parents.markers.some((m) => m.recordId === id(51) || m.recordId === id(52)),
  'Legacy parent visits never become child visits',
);
assert.equal(
  parents.omitted.find((m) => m.recordId === id(21))!.reason,
  'missing-coordinates',
  'Same-title world record cannot lend a point',
);
assert.equal(
  parents.omitted.find((m) => m.recordId === id(25))!.reason,
  'missing-coordinates',
  'Suppressed coordinates never revive without new explicit project evidence',
);
assert.equal(select(create([52])).markers[0]!.kind, 'world-heritage');
assert.equal(
  select(create([52])).markers[0]!.recordId,
  id(52),
  'Child visit does not light parent either',
);
const noDataset = structuredClone(catalog);
noDataset.sources = [];
assert.equal(select(create([20], noDataset)).markers.length, 0);
const badReference = structuredClone(catalog);
badReference.entries.find((e) => e.id === id(51))!.coordinateSourceUrl = source(999, true);
assert.equal(
  select(create([50], badReference)).markers.length,
  0,
  'Reference URL must identify this exact property',
);
const unrelatedRow = structuredClone(catalog);
unrelatedRow.entries.find((e) => e.id === id(51))!.unitKind = 'official-geographical-component';
assert.equal(
  select(create([50], unrelatedRow)).markers.length,
  0,
  'Do not borrow an arbitrary ordinary component',
);
const abnormalRow = structuredClone(catalog);
abnormalRow.entries.find((e) => e.id === id(51))!.coordinateStatus = 'source-coordinate-anomaly';
assert.equal(select(create([50], abnormalRow)).markers.length, 0);
const missingReference = structuredClone(catalog);
missingReference.entries.find((e) => e.id === id(51))!.referenceCoordinates = null;
assert.equal(select(create([50], missingReference)).markers.length, 0);
const multipleReferences = structuredClone(catalog);
const duplicateReference = {
  ...multipleReferences.entries.find((e) => e.id === id(51))!,
  id: id(151),
  recordId: id(151),
};
multipleReferences.entries.push(duplicateReference);
multipleReferences.heritageProjects![0]!.componentEntryIds.push(id(151));
assert.equal(
  select(create([50], multipleReferences)).omitted[0]!.reason,
  'ambiguous-coordinates',
  'Multiple project reference rows must not silently choose a representative',
);
assert.equal(
  select(create([10, 20]), { layers: { visitedAirports: true, visitedWorldHeritage: false } })
    .markers[0]!.kind,
  'airport',
);
assert.equal(
  select(create([10, 20]), { layers: { visitedAirports: false, visitedWorldHeritage: true } })
    .markers[0]!.kind,
  'project-reference',
);
const components = select(create([30, 31, 32, 33, 34, 35]));
assert.deepEqual(
  components.markers.map((m) => m.recordId),
  [id(30)],
);
assert.equal(
  components.counts.visitedRecords,
  4,
  'Excluded and superseded records are not heritage overlay items',
);
assert.equal(components.omitted.length, 3);
const partial = create([]);
const partialSnapshot = partial.snapshot();
partialSnapshot.entries[id(36)] = {
  visited: false,
  subitemIds: [id(136)],
  name: 'My precise personal label',
  note: 'Personal note',
};
partial.replace(partialSnapshot);
assert.equal(select(partial).markers[0]!.partial, true);
assert.equal(select(partial).markers[0]!.name, 'My precise personal label');
assert.equal(select(partial).markers[0]!.note, 'Personal note');
const shared = create([40]);
assert.equal(select(shared).markers.length, 1);
assert.equal(select(shared).markers[0]!.id, id(40));
assert.equal(visitedMapMarkers(shared, { scope: 'japan', layers: all }).markers[0]!.id, id(40));
assert.equal(select(create([44])).omitted[0]!.reason, 'ambiguous-coordinates');

// Curated identifier associations change only marker location, never visit or record identity.
const association: VerifiedVisitedMapAssociation = {
  entryId: id(11),
  recordId: id(11),
  targetEntryId: id(60),
  kind: 'airport',
  reviewStatus: 'verified-source-identifier',
  basis: 'Synthetic exact IATA evidence',
  identity: {
    scheme: 'iata',
    value: 'PEK',
    sourceField: 'name-prefix',
    sourceUrl: 'https://ourairports.com/airports/ZBAA/',
  },
};
const associated = select(create([11]), { associations: [association] });
assert.equal(associated.markers[0]!.recordId, id(11));
assert.equal(associated.markers[0]!.entryId, id(11));
assert.equal(associated.markers[0]!.coordinateEvidenceEntryId, id(60));
assert.deepEqual(associated.markers[0]!.coordinates, [116.6, 40.1]);
assert.equal(select(create([60]), { associations: [association] }).markers[0]!.recordId, id(60));
assert.equal(
  select(create([60]), { associations: [association] }).markers.length,
  1,
  'Evidence airport visit cannot turn on source China airport',
);
assert.equal(
  select(create([11]), { associations: [{ ...association, recordId: id(60) }] }).markers.length,
  0,
);
assert.equal(
  select(create([11]), {
    associations: [{ ...association, identity: { ...association.identity, value: 'NRT' } }],
  }).markers.length,
  0,
);
assert.equal(
  select(create([11]), {
    associations: [{ ...association, identity: { ...association.identity, sourceField: 'name' } }],
  }).markers.length,
  0,
);
const duplicateAirport = structuredClone(catalog);
duplicateAirport.entries.push({
  ...duplicateAirport.entries.find((e) => e.id === id(60))!,
  id: id(61),
  recordId: id(61),
});
assert.equal(
  select(create([11], duplicateAirport), { associations: [association] }).markers.length,
  0,
  'IATA target must be globally unique',
);
const foreignAirport = structuredClone(catalog);
foreignAirport.entries.find((e) => e.id === id(60))!.countryCode = 'JPN';
assert.equal(
  select(create([11], foreignAirport), { associations: [association] }).markers.length,
  0,
);
const projectAssociation: VerifiedVisitedMapAssociation = {
  entryId: id(21),
  recordId: id(21),
  targetEntryId: id(22),
  kind: 'project-reference',
  reviewStatus: 'verified-source-identifier',
  basis: 'Synthetic original official ID field',
  identity: {
    scheme: 'unesco-id',
    value: '101',
    sourceField: 'unescoId',
    sourceFile: 'synthetic-official-original.json',
    sourceUrl: source(101),
  },
};
const joinedProject = select(create([21]), { associations: [projectAssociation] });
assert.equal(joinedProject.markers[0]!.recordId, id(21));
assert.equal(joinedProject.markers[0]!.kind, 'project-reference');
assert.equal(
  joinedProject.markers.length,
  1,
  'No world record visit is created by a China project association',
);
assert.equal(
  select(create([21]), {
    associations: [
      {
        ...projectAssociation,
        identity: { ...projectAssociation.identity, sourceFile: '', sourceField: 'name' },
      },
    ],
  }).markers.length,
  0,
);

// Optional settings preserve old archives; on/off, refresh and undo use normal preference transactions.
const oldSnapshot = emptySnapshot('overlay-test-v1');
oldSnapshot.entries[id(10)] = {
  visited: true,
  subitemIds: [],
  name: 'Keep this title',
  note: 'Keep this note',
};
const pristine = structuredClone(oldSnapshot);
const prefs = new HandbookSession(new CatalogIndex(catalog), oldSnapshot);
assert.equal(visitedMapMarkers(prefs, { scope: 'china' }).markers.length, 0);
assert.deepEqual(oldSnapshot, pristine);
assert.equal(prefs.preferences.mapLayers, undefined);
prefs.transaction(() =>
  prefs.updatePreferences({ mapLayers: { visitedAirports: true, visitedWorldHeritage: false } }),
);
assert.equal(visitedMapMarkers(prefs, { scope: 'china' }).markers.length, 1);
const saved = JSON.parse(JSON.stringify(prefs.snapshot()));
const refreshed = new HandbookSession(new CatalogIndex(catalog), saved);
assert.equal(visitedMapMarkers(refreshed, { scope: 'china' }).markers.length, 1);
assert.deepEqual(refreshed.snapshot().entries, oldSnapshot.entries);
prefs.undo();
assert.equal(prefs.preferences.mapLayers, undefined);
assert.equal(visitedMapMarkers(prefs, { scope: 'china' }).markers.length, 0);
const partialPrefs = snapshotSchema.parse({
  ...pristine,
  preferences: { ...pristine.preferences, mapLayers: { visitedAirports: true } },
});
assert.deepEqual(partialPrefs.preferences.mapLayers, {
  visitedAirports: true,
  visitedWorldHeritage: false,
});
assert.throws(() =>
  snapshotSchema.parse({
    ...pristine,
    preferences: { ...pristine.preferences, mapLayers: { visitedAirports: 'yes' } },
  }),
);
assert.throws(() =>
  snapshotSchema.parse({
    ...pristine,
    preferences: { ...pristine.preferences, mapLayers: { unofficialLayer: true } },
  }),
);
const v2 = snapshotSchema.parse({ ...saved, version: 2 });
assert.equal(v2.version, 2);
prefs.transaction(() => prefs.markEntry(id(10), false));
assert.equal(select(prefs).markers.length, 0);
prefs.undo();
assert.equal(select(prefs).markers.length, 1);
const immutable = JSON.stringify(catalog);
select(parent);
select(shared);
assert.equal(JSON.stringify(catalog), immutable);
console.log(
  'PASS synthetic visited overlays: real records only; scope/known-region filters; disabled defaults; record deduplication; parent/child isolation; source-qualified references; rejected unsafe coordinates; partial/custom labels; preferences/undo/refresh.',
);

if (process.argv.includes('--actual')) {
  const root = resolve(import.meta.dirname, '..');
  const actual: Catalog = JSON.parse(
    await readFile(resolve(root, 'data/catalog/catalog.json'), 'utf8'),
  );
  const chinaRows = actual.entries.filter(
    (e) => e.scope === 'china' && ['airport', 'world-heritage'].includes(e.categoryId),
  );
  const snapshot = emptySnapshot(actual.version);
  for (const e of chinaRows) snapshot.entries[e.recordId] = { visited: true, subitemIds: [] };
  const real = new HandbookSession(new CatalogIndex(actual), snapshot);
  const selection = visitedMapMarkers(real, { scope: 'china', layers: all });
  assert.equal(chinaRows.filter((e) => e.categoryId === 'airport').length, 313);
  assert.equal(chinaRows.filter((e) => e.categoryId === 'world-heritage').length, 245);
  assert.equal(selection.counts.airports.mapped, 17);
  assert.equal(
    selection.counts.worldHeritage.mapped,
    0,
    'Unlinked China heritage cannot acquire a world record point',
  );
  assert.equal(selection.counts.worldHeritage.omitted, 245);
  assert.equal(selection.markers.length, 17);
  const associationsFile = JSON.parse(
    await readFile(
      resolve(root, 'data/extensions/research/china-airport-map-associations.json'),
      'utf8',
    ),
  );
  const associatedChina = visitedMapMarkers(real, {
    scope: 'china',
    layers: all,
    associations: associationsFile.associations,
  });
  assert.equal(associatedChina.counts.airports.mapped, 277);
  assert.equal(associatedChina.counts.airports.omitted, 36);
  assert.equal(associatedChina.counts.worldHeritage.mapped, 0);
  const originalRecords = new Set(chinaRows.map((e) => e.recordId));
  for (const marker of associatedChina.markers) assert(originalRecords.has(marker.recordId));
  assert.deepEqual(
    real.snapshot().entries,
    snapshot.entries,
    'Real-catalog location association never rewrites synthetic visits',
  );
  const report = {
    passed: true,
    catalogVersion: actual.version,
    syntheticRecordsOnly: true,
    actualChinaBaseline: selection.counts,
    actualChinaWithReviewedAirportAssociations: associatedChina.counts,
    limitations: [
      'China 245 original heritage entries have no location or stable UNESCO link in the catalogue.',
      'Further reviewed identity associations are a separate additive location input, never a visit-record merge.',
    ],
  };
  const output = resolve(root, 'data/generated/visited-map-markers');
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
  console.log(JSON.stringify(report, null, 2));
}
