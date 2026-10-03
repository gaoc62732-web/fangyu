/** Synthetic migration/identity regressions plus optional real generated-catalog validation. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalog } from '../packages/contracts/src/index.js';
import { emptySnapshot } from '../packages/contracts/src/index.js';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import { heritageProgress, validateHeritageProjects } from '../packages/domain/src/heritage.js';
import {
  SEA,
  SEA_STABLE_REF,
  seaUuid,
  buildSeaCatalog,
  assertSeaPreservation,
} from './integrate-sea-topic-data.mjs';

const square = (left: number, bottom: number, right: number, top: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
      [left, bottom],
    ],
  ],
});
const base: Catalog = {
  version: '2026-10-03.13',
  compatibleCatalogVersions: ['2026-09-28.1'],
  regions: [...SEA].map(([code]) => ({
    id: seaUuid(`synthetic-country/${code}`),
    parentId: null,
    scope: 'world',
    level: 1,
    name: code,
    code,
    historical: false,
    aliases: [],
  })),
  entries: [],
  categories: [
    { id: 'world-heritage', name: 'World Heritage' },
    { id: 'airport', name: 'Airport' },
  ],
  achievements: { definitions: [], quantityRegionIds: [] },
  sources: [],
};
const parentId = seaUuid('synthetic-parent'),
  airportId = seaUuid('synthetic-airport');
base.entries.push({
  id: parentId,
  recordId: parentId,
  scope: 'world',
  regionIds: [base.regions[0]!.id],
  categoryId: 'world-heritage',
  name: 'Original default',
  aliases: ['Old alias'],
  code: '999991',
  countryCode: 'IDN',
  coordinates: [100, 1],
  subitems: [{ id: seaUuid('synthetic-subitem'), name: 'Old part' }],
  description: 'Retain this description',
});
base.entries.push({
  id: airportId,
  recordId: airportId,
  scope: 'world',
  regionIds: [base.regions[0]!.id],
  categoryId: 'airport',
  name: 'Old airport',
  aliases: [],
  countryCode: 'IDN',
  subitems: [],
  coordinates: [100, 1],
});
const boundaries = {
  countries: [...SEA].map(([countryCode, scope]) => ({
    countryCode,
    scope,
    sourceUrl: 'https://example.invalid/synthetic-boundary',
    asOf: 'synthetic',
    limitations: ['Synthetic fixture'],
    regions:
      countryCode === 'IDN'
        ? [
            {
              code: 'P1',
              name: 'Province One',
              nameZh: '合成一省',
              nameEn: 'Province One',
              geometry: square(99, 0, 102, 2),
            },
            {
              code: 'P2',
              name: 'Province Two',
              nameZh: '合成二省',
              nameEn: 'Province Two',
              geometry: square(101, 0, 103, 2),
            },
          ]
        : [],
  })),
};
const component = (key: string, extra: Record<string, any>) => ({
  componentKey: key,
  componentId: key,
  name: key,
  nameZh: '合成地点',
  nameEn: 'Synthetic Place',
  nameOriginal: key,
  countryCode: 'IDN',
  sourceUrl: 'https://example.invalid/synthetic-unesco',
  ...extra,
});
const source = {
  projects: [
    {
      unescoId: '999991',
      name: 'Synthetic UNESCO project',
      nameZh: '合成遗产',
      nameEn: 'Synthetic UNESCO Project',
      nameOriginal: 'Original name',
      translationStatus: 'provisional',
      sourceUrl: 'https://example.invalid/synthetic-unesco',
      checkedAt: 'synthetic',
      expectedComponentCount: 4,
      coverage: 'complete',
      touristPlaceCoverage: 'partial',
      components: [
        component('999991-001', {
          coordinates: [100, 1],
          ordinaryPointEligible: true,
          coordinateRole: 'place-reference',
        }),
        component('999991-002', {
          coordinates: [100, 1],
          ordinaryPointEligible: false,
          coordinateRole: 'area-reference',
        }),
        component('999991-003', { coordinates: null }),
        component('999991-004', { coordinates: [101.5, 1], ordinaryPointEligible: true }),
      ],
    },
  ],
};
const before = structuredClone(base);
const generated = buildSeaCatalog(base, boundaries, source, '2026-10-03.14');
assert.deepEqual(base, before, 'No input catalogue mutation');
assert.equal(generated.catalog.entries.length, 6);
const byId = new Map(generated.catalog.entries.map((e) => [e.id, e]));
assert.deepEqual(
  byId.get(airportId),
  before.entries[1],
  'Old airports are not added to the new topic',
);
assert.deepEqual(byId.get(parentId)!.coordinates, [100, 1], 'Old project coordinates remain exact');
assert.deepEqual(byId.get(parentId)!.subitems, before.entries[0]!.subitems);
assert(byId.get(parentId)!.aliases.includes('Original default'));
const imported = source.projects[0]!.components.map((c) =>
  byId.get(seaUuid(`unesco/component/${c.componentKey}`))!,
);
assert.deepEqual((imported[0]!.topicRegions as any).indonesia, [seaUuid('region/indonesia/P1')]);
for (const e of imported.slice(1))
  assert.deepEqual((e.topicRegions as any).indonesia, [base.regions[0]!.id]);
assert.equal(imported[1]!.coordinates, null);
assert.deepEqual(imported[1]!.referenceCoordinates, [100, 1]);
assert.equal(imported[1]!.ordinaryPointEligible, false);
assert.equal(
  generated.catalog.heritageProjects![0]!.coverage,
  'partial',
  'Complete maps rows are not complete travel coverage',
);
const snapshot = emptySnapshot(base.version);
snapshot.entries[parentId] = {
  visited: true,
  subitemIds: [],
  note: 'Synthetic old note',
  name: 'My own name',
};
const oldRecords = structuredClone(snapshot.entries);
const session = new HandbookSession(new CatalogIndex(generated.catalog), snapshot);
assert.deepEqual(session.snapshot().entries, oldRecords, 'Names and notes migrate verbatim');
assert.equal(
  session.view(byId.get(parentId)!).name,
  'My own name',
  'Default bilingual label does not override a personal name',
);
assert.equal(
  heritageProgress(session, generated.catalog.heritageProjects![0]!).visitedComponents,
  0,
);
session.transaction(() => session.markEntry(imported[0]!.id, true));
assert.equal(
  heritageProgress(session, generated.catalog.heritageProjects![0]!).visitedComponents,
  1,
);
session.undo();
assert.deepEqual(session.snapshot().entries, oldRecords, 'Undo preserves old records');
const again = buildSeaCatalog(generated.catalog, boundaries, source, '2026-10-03.15');
assert.equal(again.catalog.entries.length, generated.catalog.entries.length);
assert.equal(again.catalog.regions.length, generated.catalog.regions.length);
assert.equal(again.report.addedEntries, 0, 'Repeat input does not duplicate records');
const duplicate = buildSeaCatalog(
  base,
  boundaries,
  { projects: [source.projects[0], structuredClone(source.projects[0])] },
  '2026-10-03.14',
);
assert.equal(duplicate.catalog.heritageProjects!.length, 1, 'One global project per UNESCO ID');
assert.equal(duplicate.report.newComponents.length, 4);
for (const field of ['recordId', 'description', 'coordinates'] as const) {
  const broken = structuredClone(generated.catalog);
  (broken.entries[0] as any)[field] = field === 'coordinates' ? [0, 0] : 'changed';
  assert.throws(() => assertSeaPreservation(base, broken), `Reject protected field ${field}`);
}
console.log(
  'PASS synthetic SEA: protected IDs/names/notes/coordinates; independent progress+undo; no airport import; reference/absent/ambiguous points country-only; repeat import; project deduplication.',
);

if (process.argv.includes('--generated')) {
  const root = resolve(import.meta.dirname, '..');
  const read = async (p: string) => JSON.parse(await readFile(resolve(root, p), 'utf8'));
  const stable = JSON.parse(
    execFileSync('git', ['show', `${SEA_STABLE_REF}:data/catalog/catalog.json`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
    }),
  );
  const [current, next, manifest] = await Promise.all([
    read('data/catalog/catalog.json'),
    read('data/generated/topic-integration/catalog.json'),
    read('data/generated/topic-integration/manifest.json'),
  ]);
  const stableResult = assertSeaPreservation(stable, next);
  assertSeaPreservation(current, next);
  validateHeritageProjects(next, next.heritageProjects);
  assert.equal(manifest.entries, next.entries.length);
  assert.equal(manifest.regions, next.regions.length);
  assert.equal(manifest.version, next.version);
  const regions = new Map(next.regions.map((r: any) => [r.id, r]));
  const categories = new Set(next.categories.map((c: any) => c.id));
  assert.equal(categories.size, next.categories.length);
  for (const e of next.entries) {
    assert(categories.has(e.categoryId));
    assert(e.regionIds.length);
    for (const id of [...e.regionIds, ...Object.values(e.topicRegions || {}).flat()])
      assert(regions.has(id));
  }
  for (const scope of SEA.values()) {
    const features = await read(`data/generated/topic-integration/${scope}.geo.json`);
    assert.equal(new Set(features.map((f: any) => f.id)).size, features.length);
    for (const f of features) assert(regions.has(f.regionId));
    const coverage = next.topicCoverage.find((c: any) => c.scope === scope);
    assert(coverage);
    assert.equal(coverage.counts.regionGeometries, features.length);
  }
  const priorIds = new Set(stable.entries.map((e: any) => e.id));
  for (const e of next.entries.filter((e: any) => !priorIds.has(e.id))) {
    assert.equal(e.categoryId, 'world-heritage-component');
    assert(SEA.has(e.countryCode));
    assert.equal(e.recordId, e.id);
    assert(e.nameZh && e.nameEn && e.originalName);
    if (e.coordinateReferenceOnly || e.ordinaryPointEligible === false)
      assert.equal(e.coordinates, null);
  }
  console.log(
    JSON.stringify(
      {
        passed: true,
        baseline: SEA_STABLE_REF,
        version: next.version,
        ...stableResult,
        newEntries: next.entries.length - stable.entries.length,
        newRegions: next.regions.length - stable.regions.length,
      },
      null,
      2,
    ),
  );
}
