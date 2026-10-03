import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const bytes = (path: string) => readFile(resolve(root, path));
const read = async (path: string) => JSON.parse((await bytes(path)).toString('utf8'));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function sorted(value: any): any {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
}
const hash = (value: any) => sha(JSON.stringify(sorted(value)));
const research = await read('data/extensions/research/indonesia-open-boundaries.json');
const catalog = await read('data/catalog/catalog.json');
const geometry = await read(research.geometryFile);
const sea = await read('data/extensions/research/sea-country-boundaries.json');
const baseline = research.preservationBaseline;
const country = sea.countries.find((item: any) => item.scope === 'indonesia');
const topic = catalog.topicCoverage.find((item: any) => item.scope === 'indonesia');
assert.equal(catalog.version, baseline.catalogVersion, 'catalog version changed');
assert.equal(hash(catalog.entries), baseline.entriesSha256, 'entry objects changed');
assert.equal(hash(catalog.regions), baseline.regionsSha256, 'region objects changed');
assert.equal(
  hash(catalog.topicCoverage.filter((x: any) => x.scope !== 'indonesia')),
  baseline.otherTopicCoverageSha256,
  'another topic changed',
);
assert.equal(
  hash(sea.countries.filter((x: any) => x.scope !== 'indonesia')),
  baseline.otherResearchCountriesSha256,
  'another research country changed',
);
assert.equal(
  hash(country.regions.map(({ geometry: _geometry, ...identity }: any) => identity)),
  baseline.indonesiaResearchIdentitySha256,
  'research region identities changed',
);
assert.equal(
  hash(geometry.map(({ geometry: _geometry, ...identity }: any) => identity)),
  baseline.geometryIdentitySha256,
  'geometry IDs/regionIds/levels changed',
);
for (const [path, expected] of Object.entries(baseline.otherGeometryFileSha256)) {
  assert.equal(sha(await bytes(path)), expected, `${path} changed`);
}
assert.equal(geometry.length, 38);
assert.equal(research.rows.length, 38);
assert.equal(new Set(research.rows.map((r: any) => r.regionId)).size, 38);
assert.equal(new Set(research.rows.map((r: any) => r.osmRelationId)).size, 38);
assert.equal(new Set(research.rows.map((r: any) => r.osmISO3166_2)).size, 38);
const byRegion = new Map(geometry.map((g: any) => [g.regionId, g]));
let polygonCount = 0;
let coordinateCount = 0;
for (const row of research.rows) {
  const item: any = byRegion.get(row.regionId);
  assert(item, `missing region ${row.code}`);
  assert.equal(item.id, row.geometryId);
  assert.equal(item.level, row.level);
  assert.equal(
    hash(item.geometry),
    row.geometrySha256,
    `${row.code} differs from approved geometry`,
  );
  assert.notEqual(
    hash(item.geometry),
    row.replacedGeometrySha256,
    `${row.code} still uses old geometry`,
  );
  const source = country.regions.find((r: any) => r.code === row.code);
  assert(source);
  assert.equal(hash(source.geometry), row.geometrySha256, `${row.code} research geometry differs`);
  assert.equal(item.geometry.type, 'MultiPolygon');
  assert(item.geometry.coordinates.length > 0);
  for (const polygon of item.geometry.coordinates) {
    polygonCount++;
    assert(polygon.length > 0);
    for (const ring of polygon) {
      assert(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
      for (const point of ring) {
        coordinateCount++;
        assert.equal(point.length, 2, 'legacy extra Z/M dimensions remain');
        assert(point.every(Number.isFinite));
        assert(point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90);
      }
    }
  }
  assert.equal(row.tls, 'default certificate verification');
  assert.match(row.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    row.sourceUrl,
    `https://api.openstreetmap.org/api/0.6/relation/${row.osmRelationId}/full.json`,
  );
}
assert.equal(polygonCount, research.validation.polygonCount);
assert.equal(coordinateCount, research.validation.coordinateCount);
assert.equal(research.validation.oldBoundaryCoordinatesUsed, false);
assert.equal(hash(topic.boundary), hash(research.metadata));
assert.equal(topic.boundary.coverage.smallIslandsComplete, false);
assert.match(topic.boundary.license, /ODbL/);
assert.match(topic.boundary.geometryProcessing.landMaskLicense, /Public Domain/);
assert(!JSON.stringify(topic.boundary).includes('big.go.id'));
assert(!JSON.stringify(topic.sources).includes('big.go.id'));
assert(!JSON.stringify(country).includes('big.go.id'));

// Offline public check relies on pinned per-feature hashes above. If local research
// caches are available, additionally verify the exact downloaded source bytes.
const localChecks: string[] = [];
const offline = process.argv.includes('--offline');
async function checkLocal(path: string, expected: string) {
  if (offline) return;
  let data: Buffer;
  try {
    data = await bytes(path);
  } catch (error: any) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  assert.equal(sha(data), expected, `source bytes changed: ${path}`);
  localChecks.push(path);
}
await checkLocal(research.approvedCandidate.localPath, research.approvedCandidate.fileSha256);
for (const row of research.rows) {
  await checkLocal(
    `data/generated/license-audit/osm-relation-${row.osmRelationId}-full.json`,
    row.sourceSha256,
  );
}
await checkLocal('data/generated/license-audit/ne_10m_land.zip', research.sources[1].fileSha256);
await checkLocal(
  'data/generated/license-audit/osm-indonesia-country.json',
  research.sources[0].fileSha256,
);
console.log(
  JSON.stringify(
    {
      status: 'pass',
      provinces: 38,
      polygonCount,
      coordinateCount,
      preservedEntries: catalog.entries.length,
      preservedRegions: catalog.regions.length,
      otherResearchCountriesUnchanged: sea.countries.length - 1,
      localSourceHashesChecked: localChecks.length,
      localSourceHashChecksSkipped: 41 - localChecks.length,
      localSourceCheckMode: offline ? 'disabled-by-offline-flag' : 'verify-if-present',
      version: catalog.version,
    },
    null,
    2,
  ),
);
