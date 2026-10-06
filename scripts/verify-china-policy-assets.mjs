// Verify geographic samples against source, export geometry, simplified map and
// actual maximum-zoom PMTiles. This catches stale assets and wrong island parents.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { PMTiles } from 'pmtiles';
import {
  removeHistoricalGeometry,
  retainReviewedChinaGeometry,
} from './lib/china-boundary-policy.mjs';
const require = createRequire(import.meta.url);
const tileRequire = createRequire(require.resolve('vt-pbf'));
const { VectorTile } = tileRequire('@mapbox/vector-tile');
const Pbf = tileRequire('pbf');
const read = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const catalog = await read('data/catalog/catalog.json');
const rawBytes = await fs.readFile('data/catalog/china.geo.json');
const report = await read('data/boundaries/china-policy/applied.json');
assert.equal(createHash('sha256').update(rawBytes).digest('hex'), report.geometrySha256);
assert(rawBytes.equals(await fs.readFile('data/generated/web/geometry/china.geo.json')));
const rows = JSON.parse(rawBytes);
assert.equal(rows.length, removeHistoricalGeometry(rows, catalog.regions).length);
assert.equal(report.failures.length, 0);
assert.equal(report.hierarchyExceptions.length, 0);
const simple = await read('data/generated/web/maps/china.json');
const manifest = await read('data/generated/web/map-manifest.json');
const layerManifest = (level) => manifest.scopes.china.layers.find((l) => l.level === level);
const archiveFile = (level) => 'data/generated/web/' + layerManifest(level).url.split('?')[0];
const maximumZoom = layerManifest('county').maxzoom;
assert(maximumZoom >= 12, 'Coastal detail must not stop at the old z11 archive');
const dash = simple.features.find((f) => f.id === 'china-official-south-china-sea-lines');
assert.equal(dash.geometry.type, 'MultiLineString');
assert.equal(dash.geometry.coordinates.length, 10);
assert.equal(dash.properties.boundaryKind, 'maritime-dash');
const landBorder = rows.find((r) => r.id === 'china-reviewed-national');
assert.equal(landBorder.boundaryKind, 'land');
assert.equal(landBorder.geometry.coordinates.length, 1, 'Land border must be one continuous route');
assert.equal(simple.features.find((f) => f.id === landBorder.id).properties.boundaryKind, 'land');
assert(
  rows
    .filter((r) => r.level === 'border')
    .every((r) => ['land', 'maritime-dash'].includes(r.boundaryKind)),
);
const coastReport = await read('data/boundaries/china-policy/coastal-mask-report.json');
assert.equal(coastReport.referenceCoastUsed, false);
assert.equal(
  createHash('sha256')
    .update(await fs.readFile('data/boundaries/china-policy/land-mask.geojson'))
    .digest('hex'),
  report.landMaskSha256,
);
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [a, b] = ring[j];
    if (y > point[1] !== b > point[1] && point[0] < ((a - x) * (point[1] - y)) / (b - y) + x)
      inside = !inside;
  }
  return inside;
}
function covers(geometry, point) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    (p) => inRing(point, p[0]) && p.slice(1).every((ring) => !inRing(point, ring)),
  );
}
const bytes = await fs.readFile(archiveFile('county'));
const archive = new PMTiles({
  getKey: () => 'china-policy-county',
  getBytes: async (offset, length) => ({
    data: new Uint8Array(bytes.subarray(offset, offset + length)).buffer,
  }),
});
const samples = [
  ['420113', [114.02, 30.26]],
  ['371003', [121.865, 36.97]],
  ['350122', [119.936, 26.151]],
  ['350305', [119.452, 24.991]],
  ['350604', [118.234, 24.162]],
  ['441581', [116.724, 20.705]],
  ['460302', [112.338, 16.834]],
  ['460303', [114.37, 10.378]],
  ['230883', [135.05, 48.4]],
  ['宜兰县', [123.475, 25.744]],
];
for (const [code, point] of samples) {
  const region = catalog.regions.find(
    (r) => r.scope === 'china' && r.level === 2 && (r.code === code || r.name === code),
  );
  assert(region, code);
  assert(
    rows.some((r) => r.regionId === region.id && covers(r.geometry, point)),
    region.name + ' source sample',
  );
  assert(
    simple.features.some((f) => f.id === region.id && covers(f.geometry, point)),
    region.name + ' simplified sample',
  );
  const n = 2 ** maximumZoom;
  const x = Math.floor(((point[0] + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((point[1] * Math.PI) / 180)) / Math.PI) / 2) * n);
  const tile = await archive.getZxy(maximumZoom, x, y);
  assert(tile, region.name + ' missing tile');
  const layer = new VectorTile(new Pbf(tile.data)).layers.regions;
  assert(
    Array.from({ length: layer.length }, (_, i) => layer.feature(i).properties.regionId).includes(
      region.id,
    ),
    region.name + ' missing tile ID',
  );
  assert(manifest.scopes.china.regionBounds[region.id], region.name + ' missing navigation bounds');
}
// An actual coastal tile must not contain the old thick national shoreline.
const borderBytes = await fs.readFile(archiveFile('border'));
const borderArchive = new PMTiles({
  getKey: () => 'china-policy-border',
  getBytes: async (offset, length) => ({
    data: new Uint8Array(borderBytes.subarray(offset, offset + length)).buffer,
  }),
});
for (const point of [
  [119.936, 26.151],
  [123.475, 25.744],
  [110.48, 20.07],
  [120.94, 32.86],
]) {
  const n = 2 ** maximumZoom;
  const x = Math.floor(((point[0] + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((point[1] * Math.PI) / 180)) / Math.PI) / 2) * n);
  const tile = await borderArchive.getZxy(maximumZoom, x, y);
  assert(
    !tile || new VectorTile(new Pbf(tile.data)).layers.regions?.length === 0,
    'Thick coastal border tile: ' + point,
  );
}
for (const [kind, point] of [
  ['land', landBorder.geometry.coordinates[0][100]],
  ['maritime-dash', dash.geometry.coordinates[0][1]],
]) {
  const n = 2 ** maximumZoom;
  const x = Math.floor(((point[0] + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((point[1] * Math.PI) / 180)) / Math.PI) / 2) * n);
  const tile = await borderArchive.getZxy(maximumZoom, x, y);
  assert(tile, kind + ' tile missing');
  const layer = new VectorTile(new Pbf(tile.data)).layers.regions;
  assert(
    Array.from(
      { length: layer.length },
      (_, i) => layer.feature(i).properties.boundaryKind,
    ).includes(kind),
    kind + ' MVT property missing',
  );
}
// A future raw OSM import cannot restore the old island attribution or sea area.
const tampered = rows.map((r) =>
  r.regionId === catalog.regions.find((x) => x.code === '420113').id
    ? {
        ...r,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      }
    : r,
);
const retained = await retainReviewedChinaGeometry(tampered, catalog.regions);
assert.deepEqual(
  retained.find((r) => r.regionId === catalog.regions.find((x) => x.code === '420113').id).geometry,
  rows.find((r) => r.regionId === catalog.regions.find((x) => x.code === '420113').id).geometry,
);
// Compare actual MVT vertices with acquired OSM vertices, rather than checking
// only whether a feature ID exists in the archive. Coarse replacement coastlines
// can pass every island witness above while losing the shoreline's shape.
const provinceBytes = await fs.readFile(archiveFile('province'));
const provinceArchive = new PMTiles({
  getKey: () => 'china-policy-province',
  getBytes: async (offset, length) => ({
    data: new Uint8Array(provinceBytes.subarray(offset, offset + length)).buffer,
  }),
});
const vertexSamples = [];
for (const [file, bounds] of [
  ['coast-zhejiang.json', [121.8, 29.7, 122.15, 29.95]],
  ['coast-hainan-north.json', [110.4, 19.8, 110.7, 20.12]],
]) {
  const response = await read('data/boundaries/china-policy/sources/' + file);
  const way = response.elements.filter((e) =>
    e.type === 'way' && e.tags?.natural === 'coastline' && e.geometry.length >= 25 &&
    e.geometry.every((p) => p.lon >= bounds[0] && p.lon <= bounds[2] && p.lat >= bounds[1] && p.lat <= bounds[3]),
  ).sort((a, b) => b.geometry.length - a.geometry.length)[0];
  assert(way, file + ': original detailed coastline witness unavailable');
  const cache = new Map();
  let matched = 0;
  for (const p of way.geometry) {
    const n = 2 ** maximumZoom;
    const px = (p.lon + 180) / 360 * n;
    const py = (1 - Math.asinh(Math.tan(p.lat * Math.PI / 180)) / Math.PI) / 2 * n;
    const x = Math.floor(px), y = Math.floor(py), key = x + '/' + y;
    if (!cache.has(key)) {
      const tile = await provinceArchive.getZxy(maximumZoom, x, y);
      assert(tile, file + ': coastline tile missing');
      const layer = new VectorTile(new Pbf(tile.data)).layers.regions;
      const vertices = new Set();
      for (let i = 0; i < layer.length; i++) for (const ring of layer.feature(i).loadGeometry())
        for (const point of ring) vertices.add(point.x + '/' + point.y);
      cache.set(key, { vertices, extent: layer.extent });
    }
    const { vertices, extent } = cache.get(key);
    if (vertices.has(Math.round((px - x) * extent) + '/' + Math.round((py - y) * extent))) matched++;
  }
  const fraction = matched / way.geometry.length;
  assert(fraction >= .98, file + ': detailed OSM vertices missing from actual tile: ' + fraction);
  vertexSamples.push({ file, osmWayId: way.id, vertices: way.geometry.length, matched, fraction });
}
await fs.writeFile('data/boundaries/china-policy/coastal-tile-precision.json', JSON.stringify({
  createdAt: new Date().toISOString(), maximumZoom, extent: 8192, samples: vertexSamples,
}, null, 2) + '\n');
console.log(
  'China policy passed: geometry hashes, historical exclusion, official line, ten source/simplified/PMTiles samples, original OSM coastal vertices in actual tiles, navigation bounds and OSM reimport preservation.',
);
