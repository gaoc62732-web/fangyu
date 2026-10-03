import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createMapStyle } from '../apps/web/src/features/maps/style.js';
import { mapAssetUrl, tianditu } from '../apps/web/src/features/maps/types.js';
import { decodeCatalogResponse } from '../apps/web/src/app/catalog-loader.js';
import { SCOPE_IDS } from '../packages/contracts/src/scopes.js';
const require = createRequire(import.meta.url);
const tileRequire = createRequire(require.resolve('vt-pbf'));
const { VectorTile } = tileRequire('@mapbox/vector-tile');
const Pbf = tileRequire('pbf');
const webRequire = createRequire(resolve('apps/web/package.json'));
const mapRequire = createRequire(webRequire.resolve('maplibre-gl/package.json'));
const { validateStyleMin } = mapRequire('@maplibre/maplibre-gl-style-spec');
const dir = 'data/generated/web/';
const manifest = JSON.parse(readFileSync(dir + 'map-manifest.json', 'utf8'));
let features = 0;
const detailedFranceCounts = { city: 8, county: 20 } as const;
const layerChecks: string[] = [];
const detailedFranceIds = new Set<string>();
for (const scope of SCOPE_IDS) {
  assert.deepEqual(
    readFileSync(dir + `geometry/${scope}.geo.json`),
    readFileSync(`data/catalog/${scope}.geo.json`),
  );
  const raw = JSON.parse(readFileSync(`data/catalog/${scope}.geo.json`, 'utf8'));
  const ids = new Set(raw.map((f: any) => f.regionId || f.id));
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
    const layerIds = new Set<string>(
      raw
        .filter((feature: any) => feature.level === layer.level)
        .map((feature: any) => String(feature.regionId || feature.id)),
    );
    const smallCountry = ['singapore', 'brunei'].includes(scope);
    const detailedFrance = scope === 'france' && layer.level in detailedFranceCounts;
    const checkCompleteLayer = smallCountry || detailedFrance;
    // Small polygons can disappear at z0. Read every tile at the layer's generated
    // maximum zoom, then compare unique IDs with this layer, not the whole country.
    const tiles = checkCompleteLayer
      ? readdirSync(dir + `tiles/${scope}/${layer.level}/${layer.maxzoom}`, { recursive: true })
          .filter((file) => String(file).endsWith('.pbf'))
          .map(
            (file) =>
              new VectorTile(
                new Pbf(
                  readFileSync(dir + `tiles/${scope}/${layer.level}/${layer.maxzoom}/${file}`),
                ),
              ),
          )
      : [new VectorTile(new Pbf(readFileSync(dir + `tiles/${scope}/${layer.level}/0/0/0.pbf`)))];
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
  }
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
