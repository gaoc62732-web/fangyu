import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import simplify from '@turf/simplify';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'data/generated/web');
const evidence = path.join(root, 'data/generated/vietnam-display-verification.json');
const baselinePath = path.join(root, 'data/generated/vietnam-display-baseline.json');
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const rawPath = path.join(root, 'data/catalog/vietnam.geo.json');
const rawBytes = await fs.readFile(rawPath);
const raw = JSON.parse(rawBytes.toString('utf8'));
const mask = await read(
  path.join(root, 'data/extensions/research/south-china-sea-interaction-mask.json'),
);
const manifest = await read(path.join(output, 'map-manifest.json'));

async function otherScopeState() {
  const maps: Record<string, string> = {};
  for (const scope of Object.keys(manifest.scopes).filter((s) => s !== 'vietnam')) {
    maps[scope] = sha(await fs.readFile(path.join(output, 'maps', scope + '.json')));
  }
  return {
    maps,
    manifestScopes: Object.fromEntries(
      Object.entries(manifest.scopes).filter(([s]) => s !== 'vietnam'),
    ),
  };
}
if (process.argv.includes('--snapshot')) {
  await fs.writeFile(baselinePath, JSON.stringify(await otherScopeState()));
  console.log('Saved other-scope display/map-manifest baseline.');
  process.exit(0);
}

type Polygon = number[][][];
const polys = (g: any): Polygon[] => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]);
const kh = '03b1f2d4-fbb8-5fcd-9fbb-cbb70c63cc3f';
const dn = '425fed1a-80c6-59fb-862b-ffde41ed51d1';
// Independent, reviewed component ranges: not the production filtering function.
const excluded = (id: string, i: number) =>
  id === kh ? (i >= 69 && i <= 119) || i >= 134 : id === dn && i >= 14;
assert.equal(sha(rawBytes), '33342a5b84195a04eee593972574bd366f8b886e4c07b104a5919301b81a7e28');
assert.deepEqual(
  await fs.readFile(path.join(output, 'geometry/vietnam.geo.json')),
  rawBytes,
  'Evidence geometry copy stays byte-identical',
);
assert.equal(
  raw.reduce((n: number, r: any) => n + polys(r.geometry).length, 0),
  2703,
);
const display = raw.map((r: any) => ({
  ...r,
  geometry: {
    ...r.geometry,
    coordinates:
      r.geometry.type === 'MultiPolygon'
        ? polys(r.geometry).filter((_, i) => !excluded(r.regionId, i))
        : r.geometry.coordinates,
  },
}));
assert.equal(
  display.reduce((n: number, r: any) => n + polys(r.geometry).length, 0),
  2375,
);
const simplified = await read(path.join(output, 'maps/vietnam.json'));
assert.equal(simplified.features.length, 34);
assert.equal(
  simplified.features.reduce((n: number, f: any) => n + polys(f.geometry).length, 0),
  2375,
);
for (const row of display) {
  const actual = simplified.features.find((f: any) => f.properties.regionId === row.regionId);
  assert(actual, `Region ${row.regionId} retained`);
  // Exact retained-coordinate input plus existing simplifier; checks no near-coast component was removed.
  let expected = row.geometry;
  try {
    expected = simplify(
      { type: 'Feature', properties: {}, geometry: row.geometry },
      { tolerance: 0.012, highQuality: true },
    ).geometry;
  } catch {}
  assert.deepEqual(
    actual.geometry,
    expected,
    `Only audited components removed for ${row.regionId}`,
  );
}
const bounds = (g: any): number[] => {
  const points = polys(g).flat(2);
  return [
    Math.min(...points.map((p) => p[0]!)),
    Math.min(...points.map((p) => p[1]!)),
    Math.max(...points.map((p) => p[0]!)),
    Math.max(...points.map((p) => p[1]!)),
  ];
};
const merge = (a: number[], b: number[]) => [
  Math.min(a[0]!, b[0]!),
  Math.min(a[1]!, b[1]!),
  Math.max(a[2]!, b[2]!),
  Math.max(a[3]!, b[3]!),
];
const expectedBounds = display.map((r: any) => bounds(r.geometry)).reduce(merge);
assert.deepEqual(
  manifest.scopes.vietnam.bounds,
  expectedBounds,
  'Initial/return fit uses retained display extent',
);
const regionBounds = new Map<string, number[]>(
  display.map((r: any) => [r.regionId, bounds(r.geometry)]),
);
for (const [id, b] of regionBounds)
  assert.deepEqual(
    manifest.scopes.vietnam.regionBounds[id],
    b,
    'Selected-region fit omits offshore geometry',
  );
for (const layer of manifest.scopes.vietnam.layers) assert.deepEqual(layer.bounds, expectedBounds);
assert.equal(manifest.scopes.france.layers.find((l: any) => l.level === 'city').maxzoom, 9);
assert.equal(manifest.scopes.france.layers.find((l: any) => l.level === 'county').maxzoom, 12);

const require = createRequire(import.meta.url);
const vtRequire = createRequire(require.resolve('vt-pbf'));
const { VectorTile } = vtRequire('@mapbox/vector-tile');
const Pbf = vtRequire('pbf');
function ringContains(p: number[], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (
      a[1]! > p[1]! !== b[1]! > p[1]! &&
      p[0]! < ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    )
      inside = !inside;
  }
  return inside;
}
const contains = (p: number[], g: any) =>
  polys(g).some(
    (poly) => ringContains(p, poly[0]!) && !poly.slice(1).some((r) => ringContains(p, r)),
  );
const positiveTests = (
  await read(
    path.join(root, 'data/extensions/research/south-china-sea-interaction-testpoints.json'),
  )
).tests.filter((t: any) => t.expectedBlockedInScopes.length);
for (const t of positiveTests)
  assert(
    !simplified.features.some((f: any) => contains(t.coordinate, f.geometry)),
    `No excluded component in Canvas/PNG input: ${t.id}`,
  );
const files = await fs.readdir(path.join(output, 'tiles/vietnam'), { recursive: true });
let tiles = 0,
  features = 0;
const zooms = new Set<number>();
for (const name of files.filter((f) => f.endsWith('.pbf'))) {
  const parts = name.split(/[\\/]/);
  const z = Number(parts[1]),
    x = Number(parts[2]),
    y = Number(parts[3]!.replace('.pbf', ''));
  const tile = new VectorTile(new Pbf(await fs.readFile(path.join(output, 'tiles/vietnam', name))));
  tiles++;
  zooms.add(z);
  const layer = tile.layers.regions;
  if (!layer) continue;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i).toGeoJSON(x, y, z);
    const b = regionBounds.get(f.properties.regionId);
    assert(b, 'Every MVT feature has retained catalog region');
    const fb = bounds(f.geometry);
    const tolerance = (2 * 360) / (2 ** z * 4096); // Conservative MVT coordinate quantization allowance.
    assert(
      fb[0]! >= b[0]! - tolerance &&
        fb[1]! >= b[1]! - tolerance &&
        fb[2]! <= b[2]! + tolerance &&
        fb[3]! <= b[3]! + tolerance,
      `No offshore/stale MVT geometry at ${name}`,
    );
    for (const t of positiveTests)
      assert(!contains(t.coordinate, f.geometry), `MVT exclusion ${name}:${t.id}`);
    features++;
  }
}
assert.deepEqual([...zooms].sort(), [0, 1, 2, 3, 4, 5]);
const baseline = await read(baselinePath);
assert.deepEqual(
  await otherScopeState(),
  baseline,
  'Other scope display maps and manifest unchanged',
);
const report = {
  checkedAt: new Date().toISOString(),
  rawSha256: sha(rawBytes),
  maskSha256: sha(
    await fs.readFile(
      path.join(root, 'data/extensions/research/south-china-sea-interaction-mask.json'),
    ),
  ),
  rawComponents: 2703,
  removedComponents: 328,
  retainedComponents: 2375,
  regionsRetained: 34,
  displayBounds: expectedBounds,
  allMvtZooms: [...zooms].sort(),
  tilesDecoded: tiles,
  tileFeaturesChecked: features,
  exclusionPointsChecked: positiveTests.length,
  otherScopeMapsAndManifestUnchanged: true,
  rawEvidenceCopyUnchanged: true,
  franceZoomsPreserved: true,
  status: 'PASS',
  limitation:
    'Artifact verification; browser resize, navigation and PNG visual acceptance handled separately.',
};
await fs.writeFile(evidence, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
