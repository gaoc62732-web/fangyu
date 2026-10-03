import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalog, GeometryFeature, RecordSnapshot } from '../packages/contracts/src/index.js';
import { emptySnapshot } from '../packages/contracts/src/index.js';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import { seaUuid as uuid } from './integrate-sea-topic-data.mjs';
import {
  buildFranceDrilldown,
  assertFrancePreservation,
  franceChildId,
  IDF_DEPARTMENTS,
  PARIS_ARRONDISSEMENTS,
  FRANCE_DRILLDOWN_BASELINE,
} from './integrate-france-drilldown.mjs';

const idfId = uuid('synthetic-france-idf'),
  countryId = uuid('synthetic-france-country');
const oldEntryId = uuid('synthetic-france-entry'),
  oldPartId = uuid('synthetic-france-subitem');
const square = {
  type: 'Polygon',
  coordinates: [
    [
      [2, 48],
      [3, 48],
      [3, 49],
      [2, 49],
      [2, 48],
    ],
  ],
} as const;
const old: Catalog = {
  version: '2026-10-03.14',
  compatibleCatalogVersions: ['2026-10-03.13'],
  regions: [
    {
      id: countryId,
      parentId: null,
      scope: 'world',
      level: 0,
      code: 'FRA',
      name: 'France',
      aliases: [],
      historical: false,
    },
    {
      id: idfId,
      parentId: countryId,
      scope: 'france',
      level: 1,
      code: 'FR-IDF',
      name: 'Île-de-France',
      aliases: ['IDF'],
      historical: false,
    },
  ],
  entries: [
    {
      id: oldEntryId,
      recordId: oldEntryId,
      scope: 'world',
      regionIds: [countryId],
      topicRegions: { france: [idfId] },
      categoryId: 'world-heritage',
      name: 'Old heritage name',
      coordinates: [2.5, 48.5],
      aliases: ['Original alias'],
      subitems: [{ id: oldPartId, name: 'Retained subitem' }],
    },
  ],
  categories: [{ id: 'world-heritage', name: 'Heritage' }],
  achievements: { definitions: [], quantityRegionIds: [idfId] },
  sources: [],
  topicCoverage: [
    {
      scope: 'france',
      counts: { regions: 1, regionGeometries: 1 },
      notes: ['Existing limit'],
      sources: ['https://example.invalid/old'],
    },
  ],
};
const oldGeometry: GeometryFeature[] = [
  {
    id: uuid('synthetic-province-feature'),
    regionId: idfId,
    level: 'province',
    geometry: JSON.parse(JSON.stringify(square)),
  },
];
const source = {
  scope: 'france',
  countryCode: 'FRA',
  parentRegionCode: 'FR-IDF',
  checkedAt: 'synthetic',
  asOf: 'synthetic',
  sourceUrl: 'https://example.invalid/public-source',
  license: 'Synthetic fixture only',
  regions: [...IDF_DEPARTMENTS, ...PARIS_ARRONDISSEMENTS].map((code) => ({
    code,
    parentCode: IDF_DEPARTMENTS.includes(code) ? 'FR-IDF' : '75',
    name: `Synthetic ${code}`,
    nameZh: `合成行政区${code}`,
    nameEn: `Synthetic Area ${code}`,
    originalName: `Synthetic ${code}`,
    geometry: JSON.parse(JSON.stringify(square)),
  })),
};
const pristine = structuredClone(old);
const result = buildFranceDrilldown(old, oldGeometry, source, '2026-10-03.15');
assert.deepEqual(old, pristine, 'Importer never mutates its input');
assert.equal(result.report.addedEntries, 0);
assert.equal(result.report.addedRegions, 28);
const index = new CatalogIndex(result.catalog);
assert.equal(index.children.get(idfId)?.length, 8);
assert.equal(index.children.get(franceChildId('75'))?.length, 20);
assert.deepEqual(
  index.ancestors(franceChildId('75101')).map((r) => r.id),
  [countryId, idfId, franceChildId('75'), franceChildId('75101')],
);
const snapshot = emptySnapshot(old.version);
snapshot.regions[idfId] = 'resident';
snapshot.entries[oldEntryId] = {
  visited: false,
  subitemIds: [oldPartId],
  name: 'My personal name',
  note: 'My personal note',
};
const customId = uuid('synthetic-france-custom-entry');
snapshot.customEntries.push({
  id: customId,
  recordId: customId,
  scope: 'france',
  regionIds: [idfId],
  categoryId: 'world-heritage',
  name: 'My custom place',
  aliases: ['My alias'],
  subitems: [],
});
snapshot.entries[customId] = { visited: true, subitemIds: [], note: 'Custom place note' };
const preserved = structuredClone(snapshot);
const session = new HandbookSession(index, snapshot);
assert.deepEqual(snapshot, preserved);
assert.deepEqual(session.snapshot().entries, preserved.entries);
assert.deepEqual(session.snapshot().customEntries, preserved.customEntries);
assert.deepEqual(session.snapshot().regions, preserved.regions);
assert.equal(session.view(index.entries.get(oldEntryId)!).name, 'My personal name');
for (const code of [...IDF_DEPARTMENTS, ...PARIS_ARRONDISSEMENTS])
  assert.equal(
    session.visitState(franceChildId(code)),
    'unvisited',
    'Old regional visit cannot mark new children',
  );
const tierCounts = (s: HandbookSession) =>
  [
    [idfId],
    index.children.get(idfId)!.map((r) => r.id),
    index.children.get(franceChildId('75'))!.map((r) => r.id),
  ].map((ids) => ({ total: ids.length, arrived: ids.filter((id) => s.arrived(id)).length }));
assert.deepEqual(tierCounts(session), [
  { total: 1, arrived: 1 },
  { total: 8, arrived: 0 },
  { total: 20, arrived: 0 },
]);
session.transaction(() => session.setRegionState(franceChildId('75101'), 'shortstay', false));
assert.equal(
  session.visitState(franceChildId('75')),
  'unvisited',
  'Child arrival must not imply department arrival',
);
assert.equal(session.visitState(idfId), 'resident');
assert.deepEqual(tierCounts(session), [
  { total: 1, arrived: 1 },
  { total: 8, arrived: 0 },
  { total: 20, arrived: 1 },
]);
const exported = JSON.stringify(session.snapshot());
const restored = new HandbookSession(index, JSON.parse(exported) as RecordSnapshot);
assert.deepEqual(
  restored.snapshot(),
  session.snapshot(),
  'JSON export/import preserves all layered records and custom data',
);
session.undo();
assert.deepEqual(session.snapshot().regions, preserved.regions);
assert.deepEqual(session.snapshot().entries, preserved.entries);
assert.deepEqual(session.snapshot().customEntries, preserved.customEntries);
// Session exposes undo, not a redo API: repeat the same explicit action after undo.
session.transaction(() => session.setRegionState(franceChildId('75101'), 'shortstay', false));
const afterReapply = structuredClone(session.snapshot().regions);
session.transaction(() => session.setRegionState(franceChildId('75101'), 'shortstay', false));
assert.deepEqual(
  session.snapshot().regions,
  afterReapply,
  'Repeated clicks do not increase state or propagate',
);
assert.equal(session.visitState(franceChildId('75')), 'unvisited');
assert.deepEqual(tierCounts(session), [
  { total: 1, arrived: 1 },
  { total: 8, arrived: 0 },
  { total: 20, arrived: 1 },
]);
assert.deepEqual(result.catalog.achievements.quantityRegionIds, old.achievements.quantityRegionIds);
const blank = new HandbookSession(index);
blank.transaction(() => blank.setRegionState(franceChildId('75'), 'arrived', false));
assert.equal(blank.visitState(idfId), 'unvisited');
assert.equal(blank.visitState(franceChildId('75101')), 'unvisited');
const repeat = buildFranceDrilldown(result.catalog, result.geometry, source, '2026-10-03.16');
assert.equal(repeat.report.addedRegions, 0);
assert.deepEqual(repeat.geometry, result.geometry);
assert.deepEqual(repeat.catalog.regions, result.catalog.regions);
const outside = structuredClone(source);
outside.regions[0]!.code = '13';
assert.throws(
  () => buildFranceDrilldown(old, oldGeometry, outside, '2026-10-03.15'),
  'No all-France expansion',
);
for (const mutation of [
  (c: Catalog, _g: GeometryFeature[]) => {
    c.entries[0]!.coordinates = [0, 0];
  },
  (c: Catalog, _g: GeometryFeature[]) => {
    c.entries[0]!.name = 'Changed';
  },
  (c: Catalog, _g: GeometryFeature[]) => {
    c.entries[0]!.topicRegions = { france: [franceChildId('75')] };
  },
  (c: Catalog, _g: GeometryFeature[]) => {
    c.regions[1]!.parentId = null;
  },
  (_c: Catalog, g: GeometryFeature[]) => {
    g[0]!.level = 'city';
  },
]) {
  const changed = structuredClone(result);
  mutation(changed.catalog, changed.geometry);
  assert.throws(() =>
    assertFrancePreservation(old, changed.catalog, oldGeometry, changed.geometry),
  );
}
console.log(
  'PASS synthetic France: exact old data/geometry; independent parent/child states; tier counts; custom names/notes/entries; JSON round-trip; undo; repeat import; bounded scope.',
);

if (process.argv.includes('--generated')) {
  const root = resolve(import.meta.dirname, '..');
  const read = async (p: string) => JSON.parse(await readFile(resolve(root, p), 'utf8'));
  const gitJson = (p: string) =>
    JSON.parse(
      execFileSync('git', ['show', `${FRANCE_DRILLDOWN_BASELINE}:${p}`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 80 * 1024 * 1024,
      }),
    );
  const [current, geo, next, nextGeo, manifest] = await Promise.all([
    read('data/catalog/catalog.json'),
    read('data/catalog/france.geo.json'),
    read('data/generated/france-drilldown/catalog.json'),
    read('data/generated/france-drilldown/france.geo.json'),
    read('data/generated/france-drilldown/manifest.json'),
  ]);
  assertFrancePreservation(current, next, geo, nextGeo);
  const baseline = assertFrancePreservation(
    gitJson('data/catalog/catalog.json'),
    next,
    gitJson('data/catalog/france.geo.json'),
    nextGeo,
  );
  assert.equal(manifest.version, next.version);
  assert.equal(manifest.entries, next.entries.length);
  assert.equal(manifest.regions, next.regions.length);
  const realIndex = new CatalogIndex(next);
  const idf = next.regions.find((r: any) => r.scope === 'france' && r.code === 'FR-IDF');
  assert(idf);
  assert.equal(realIndex.children.get(idf.id)?.length, 8);
  assert.equal(realIndex.children.get(franceChildId('75'))?.length, 20);
  assert.equal(nextGeo.length, 46);
  assert.equal(nextGeo.filter((f: any) => f.level === 'province').length, 18);
  for (const code of IDF_DEPARTMENTS)
    assert.equal(realIndex.regions.get(franceChildId(code))!.level, idf.level + 1);
  for (const code of PARIS_ARRONDISSEMENTS)
    assert.equal(realIndex.regions.get(franceChildId(code))!.level, idf.level + 2);
  for (const feature of nextGeo) assert(realIndex.regions.has(feature.regionId));
  const report = {
    passed: true,
    baseline: FRANCE_DRILLDOWN_BASELINE,
    version: next.version,
    ...baseline,
    departmentCount: 8,
    arrondissementCount: 20,
    provinceGeometryCount: 18,
    cityGeometryCount: 8,
    countyGeometryCount: 20,
    tests: [
      'synthetic independent region states',
      'custom names/notes/customEntries preserved',
      'JSON export/import',
      'tier denominators independent',
      'repeat import',
      'strict stable/current compatibility',
      'all old geometry exact',
      'manifest counts',
    ],
  };
  await writeFile(
    resolve(root, 'data/generated/france-drilldown/verification.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
  console.log(JSON.stringify(report, null, 2));
}
