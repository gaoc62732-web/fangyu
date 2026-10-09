import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createMapStyle } from '../apps/web/src/features/maps/style.js';
import { mapAssetUrl, tianditu } from '../apps/web/src/features/maps/types.js';
import { decodeCatalogResponse } from '../apps/web/src/app/catalog-loader.js';
import { libertyBasemap } from '../apps/web/src/features/maps/liberty-basemap.js';
import { PMTiles } from 'pmtiles';
import { SCOPE_IDS } from '../packages/contracts/src/scopes.js';
const require = createRequire(import.meta.url);
const tileRequire = createRequire(require.resolve('vt-pbf'));
const { VectorTile } = tileRequire('@mapbox/vector-tile');
const Pbf = tileRequire('pbf');
const webRequire = createRequire(resolve('apps/web/package.json'));
const mapRequire = createRequire(webRequire.resolve('maplibre-gl/package.json'));
const { validateStyleMin, expression } = mapRequire('@maplibre/maplibre-gl-style-spec');
const dir = 'data/generated/web/';
const manifest = JSON.parse(readFileSync(dir + 'map-manifest.json', 'utf8'));
const tileXY = (longitude: number, latitude: number, zoom: number): [number, number] => {
  const scale = 2 ** zoom;
  return [
    Math.max(0, Math.min(scale - 1, Math.floor(((longitude + 180) / 360) * scale))),
    Math.max(
      0,
      Math.min(
        scale - 1,
        Math.floor(((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) * scale),
      ),
    ),
  ];
};
const vectorTileAt = (layer: any, zoom: number, x: number, y: number) => {
  const url = layer.url
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  assert(!url.includes('{'), `Unresolved tile template: ${layer.url}`);
  return new VectorTile(new Pbf(readFileSync(dir + url)));
};
const vectorTilesAtBounds = (layer: any, zoom: number) => {
  const northwest = tileXY(layer.bounds[0], layer.bounds[3], zoom);
  const southeast = tileXY(layer.bounds[2], layer.bounds[1], zoom);
  const tiles = [];
  for (let x = northwest[0]; x <= southeast[0]; x++)
    for (let y = northwest[1]; y <= southeast[1]; y++) tiles.push(vectorTileAt(layer, zoom, x, y));
  return tiles;
};
let features = 0;
const detailedFranceCounts = { city: 8, county: 20 } as const;
const layerChecks: string[] = [];
const detailedFranceIds = new Set<string>();
for (const scope of SCOPE_IDS) {
  assert(
    readFileSync(dir + `geometry/${scope}.geo.json`).equals(
      readFileSync(`data/catalog/${scope}.geo.json`),
    ),
    `${scope}: generated raw geometry must match source`,
  );
  const raw = JSON.parse(readFileSync(`data/catalog/${scope}.geo.json`, 'utf8'));
  const ids = new Set(raw.map((f: any) => f.regionId || f.id));
  if (['malaysia', 'singapore', 'brunei'].includes(scope)) ids.add(`border-${scope}`);
  if (scope === 'france') {
    for (const [level, expectedCount] of Object.entries(detailedFranceCounts)) {
      assert(
        manifest.scopes[scope].layers.some((layer: any) => layer.level === level),
        `France manifest must register its ${level} layer`,
      );
      const levelIds = new Set(
        raw.filter((f: any) => f.level === level).map((f: any) => f.regionId || f.id),
      );
      assert.equal(levelIds.size, expectedCount, `France ${level} source region count`);
    }
  }
  for (const layer of manifest.scopes[scope].layers) {
    let archiveTile: any;
    if (layer.archive) {
      const bytes = readFileSync(dir + layer.url.split('?')[0]);
      const archive = new PMTiles({
        getKey: () => layer.url,
        getBytes: async (offset: number, length: number) => ({
          data: new Uint8Array(bytes.subarray(offset, offset + length)).buffer,
        }),
      });
      const header = await archive.getHeader();
      assert.equal(header.maxZoom, layer.maxzoom, `${scope}/${layer.level} manifest maxzoom`);
      assert.equal(((await archive.getMetadata()) as any).vector_layers[0].id, 'regions');
      archiveTile = await archive.getZxy(0, 0, 0);
      assert(archiveTile, `${layer.level} archive root tile`);
      // Beijing detail must be readable through leaf directories and retain IDs.
      const sampleZoom = Number(layer.maxzoom);
      assert(Number.isInteger(sampleZoom), `${scope}/${layer.level} manifest maxzoom`);
      const [sampleX, sampleY] = tileXY(116.397, 39.908, sampleZoom);
      const tile = await archive.getZxy(sampleZoom, sampleX, sampleY);
      if (tile) assert(new VectorTile(new Pbf(tile.data)).layers.regions.length > 0);
    }
    const layerIds =
      layer.level === 'border' && ['malaysia', 'singapore', 'brunei'].includes(scope)
        ? new Set([`border-${scope}`])
        : new Set<string>(
            raw
              .filter((feature: any) => feature.level === layer.level)
              .map((feature: any) => String(feature.regionId || feature.id)),
          );
    const smallCountry = ['singapore', 'brunei'].includes(scope);
    const detailedFrance = scope === 'france' && layer.level in detailedFranceCounts;
    const checkCompleteLayer = smallCountry || detailedFrance;
    // Small polygons can disappear at z0. Read every tile at the layer's generated
    // maximum zoom, then compare unique IDs with this layer, not the whole country.
    const tiles = layer.archive
      ? [new VectorTile(new Pbf(archiveTile.data))]
      : checkCompleteLayer
        ? vectorTilesAtBounds(layer, Number(layer.maxzoom))
        : [vectorTileAt(layer, 0, 0, 0)];
    const visibleIds = new Set<string>();
    for (const current of tiles) {
      if (!current.layers.regions) continue;
      for (let i = 0; i < current.layers.regions.length; i++) {
        const feature = current.layers.regions.feature(i);
        assert(ids.has(feature.properties.regionId), 'MVT must retain original region identifiers');
        assert.equal(feature.properties.level, layer.level);
        assert(
          layerIds.has(String(feature.properties.regionId)),
          `${scope}/${layer.level} must not contain another layer's regions`,
        );
        visibleIds.add(String(feature.properties.regionId));
        features++;
      }
    }
    assert(visibleIds.size > 0, `${scope}/${layer.level} has visible features at its useful zoom`);
    if (checkCompleteLayer) {
      assert.deepEqual(
        visibleIds,
        layerIds,
        `Every ${scope}/${layer.level} region survives tile generation at z${layer.maxzoom}`,
      );
      layerChecks.push(`${scope}/${layer.level}: ${visibleIds.size} IDs at z${layer.maxzoom}`);
    }
    if (detailedFrance) {
      for (const id of visibleIds) {
        assert(!detailedFranceIds.has(id), 'France city/county layers must have distinct IDs');
        detailedFranceIds.add(id);
      }
    }
  }
  for (const provider of [
    null,
    libertyBasemap(),
    tianditu('synthetic_test_key'),
    tianditu('synthetic_test_key', 'satellite'),
  ]) {
    const style = createMapStyle(
      manifest,
      scope,
      manifest.scopes[scope].layers[0].level,
      provider,
      '/fangyu/',
      'https://example.invalid/',
    );
    assert.deepEqual(validateStyleMin(style), [], 'MapLibre style schema');
    if (provider?.id === 'openfreemap') {
      for (const layer of style.layers) {
        if (!layer.id.startsWith('base-') || layer.type !== 'symbol') continue;
        const field = layer.layout?.['text-field'];
        if (!field) continue;
        const parsed = expression.createExpression(field, `layers.${layer.id}.layout.text-field`);
        assert.equal(parsed.result, 'success');
        // Both tags exist: a foreign map must keep the native name even when
        // OSM supplies a Chinese translation. China still prefers Chinese.
        const feature = { properties: { name: 'Châtelet', 'name:zh': '沙特莱' } };
        assert.equal(
          parsed.value.evaluate({ zoom: 15 }, feature),
          scope === 'china' ? '沙特莱' : 'Châtelet',
          `${scope}/${layer.id}: native versus Chinese name preference`,
        );
        assert.equal(
          parsed.value.evaluate({ zoom: 15 }, { properties: { name: 'Local name' } }),
          'Local name',
          `${scope}/${layer.id}: default name when no Chinese tag exists`,
        );
      }
    }
  }
}
// Creating the China style must not mutate the shared provider used by other maps.
for (const layer of libertyBasemap().style!.layers) {
  if (layer.type === 'symbol' && layer.layout?.['text-field'])
    assert.deepEqual(layer.layout['text-field'], ['get', 'name']);
}
assert.equal(detailedFranceIds.size, 28, 'All 8 French departments and 20 Paris districts survive');
assert.equal(tianditu(''), null);
assert.equal(tianditu('invalid space key'), null);
assert.equal(
  mapAssetUrl('/fangyu/', 'tiles/{z}/{x}/{y}.pbf', 'https://example.invalid/'),
  'https://example.invalid/fangyu/tiles/{z}/{x}/{y}.pbf',
);
const sample = { version: 'test', regions: [], entries: [], categories: [] };
assert.deepEqual(await decodeCatalogResponse(new Response(JSON.stringify(sample))), sample);
assert.deepEqual(
  await decodeCatalogResponse(new Response(gzipSync(JSON.stringify(sample)))),
  sample,
);
await assert.rejects(decodeCatalogResponse(new Response('')));
console.log(
  `PASS: ${SCOPE_IDS.length} raw geometries byte-identical; ${features} MVT feature IDs; ${SCOPE_IDS.length * 3} map styles; subpath URLs; optional key; gzip/raw/empty catalog decoding.`,
);
console.log('Complete high-zoom layers: ' + layerChecks.join('; '));
