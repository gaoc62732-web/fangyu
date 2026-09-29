import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import simplify from '@turf/simplify';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.join(root, 'data/catalog'),
  output = path.join(root, 'data/generated/web');
const scopes = ['china', 'world', 'japan', 'korea'];
const sourceNames = ['catalog.json', ...scopes.map((s) => s + '.geo.json')];
const hash = createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url)));
hash.update(await fs.readFile(path.join(root, 'apps/web/assets/fangyu-seal.woff2')));
for (const name of sourceNames) hash.update(await fs.readFile(path.join(input, name)));
const stamp = hash.digest('hex');
if ((await fs.readFile(path.join(output, '.stamp'), 'utf8').catch(() => null)) === stamp) {
  console.log('Web assets are current.');
  process.exit(0);
}
await fs.mkdir(output, { recursive: true });
const catalog = JSON.parse(await fs.readFile(path.join(input, 'catalog.json'), 'utf8'));
await fs.writeFile(path.join(output, 'catalog.json.gz'), gzipSync(JSON.stringify(catalog)));
await fs.writeFile(
  path.join(output, 'bootstrap.json'),
  JSON.stringify({
    version: catalog.version,
    regions: catalog.regions,
    categories: catalog.categories,
  }),
);
await fs.writeFile(
  path.join(output, 'catalog-manifest.json'),
  JSON.stringify({ version: stamp, file: 'catalog.json.gz', encoding: 'gzip' }),
);
const regionMap = new Map(catalog.regions.map((r) => [r.id, r]));
const manifest = { version: catalog.version, scopes: {} };
const bbox = (geometry) => {
  const b = [180, 85, -180, -85];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]);
      b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]);
      b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  if (geometry.coordinates) walk(geometry.coordinates);
  return [Math.max(-180, b[0]), Math.max(-85, b[1]), Math.min(180, b[2]), Math.min(85, b[3])];
};
const merge = (a, b) =>
  a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b;
function tileXY(lon, lat, z) {
  const n = 2 ** z;
  return [
    Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n))),
    Math.max(
      0,
      Math.min(
        n - 1,
        Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
      ),
    ),
  ];
}
for (const scope of scopes) {
  const raw = JSON.parse(await fs.readFile(path.join(input, scope + '.geo.json'), 'utf8'));
  await fs.mkdir(path.join(output, 'geometry'), { recursive: true });
  await fs.copyFile(
    path.join(input, scope + '.geo.json'),
    path.join(output, 'geometry', scope + '.geo.json'),
  );
  const regionBounds = {};
  let allBounds;
  const features = raw.map((f) => {
    const bounds = bbox(f.geometry);
    allBounds = merge(allBounds, bounds);
    if (f.regionId) {
      regionBounds[f.regionId] = merge(regionBounds[f.regionId], bounds);
      let parent = regionMap.get(f.regionId)?.parentId;
      while (parent && regionMap.get(parent)?.scope === scope) {
        regionBounds[parent] = merge(regionBounds[parent], bounds);
        parent = regionMap.get(parent)?.parentId;
      }
    }
    return {
      type: 'Feature',
      id: f.regionId || f.id,
      properties: {
        regionId: f.regionId || f.id,
        level: f.level,
        name: regionMap.get(f.regionId)?.name || '',
      },
      geometry: f.geometry,
    };
  });
  const simple = {
    type: 'FeatureCollection',
    features: features.map((f) => {
      try {
        return simplify(f, { tolerance: scope === 'world' ? 0.06 : 0.012, highQuality: true });
      } catch {
        return f;
      }
    }),
  };
  await fs.mkdir(path.join(output, 'maps'), { recursive: true });
  await fs.writeFile(path.join(output, 'maps', scope + '.json'), JSON.stringify(simple));
  const layers = [];
  for (const level of [...new Set(raw.map((f) => f.level))]) {
    const selected = features.filter((f) => f.properties.level === level);
    const maxzoom = scope === 'world' ? 3 : level === 'county' ? 7 : level === 'city' ? 6 : 5;
    const bounds = selected.reduce((b, f) => merge(b, bbox(f.geometry)), null);
    const index = geojsonvt(
      { type: 'FeatureCollection', features: selected },
      {
        maxZoom: maxzoom,
        indexMaxZoom: Math.min(5, maxzoom),
        tolerance: 2,
        extent: 4096,
        buffer: 64,
        promoteId: 'regionId',
      },
    );
    let count = 0;
    for (let z = 0; z <= maxzoom; z++) {
      const nw = tileXY(bounds[0], bounds[3], z),
        se = tileXY(bounds[2], bounds[1], z);
      for (let x = nw[0]; x <= se[0]; x++) {
        const folder = path.join(output, 'tiles', scope, level, String(z), String(x));
        await fs.mkdir(folder, { recursive: true });
        for (let y = nw[1]; y <= se[1]; y++) {
          const tile = index.getTile(z, x, y);
          const bytes = vtpbf.fromGeojsonVt({ regions: tile || { features: [] } });
          await fs.writeFile(path.join(folder, y + '.pbf'), bytes);
          count++;
        }
      }
    }
    layers.push({
      level,
      maxzoom,
      bounds,
      url: 'tiles/' + scope + '/' + level + '/{z}/{x}/{y}.pbf',
    });
    console.log(scope + '/' + level + ': ' + count + ' tiles');
  }
  manifest.scopes[scope] = {
    bounds: allBounds,
    regionBounds,
    layers,
    simplified: 'maps/' + scope + '.json',
  };
}
await fs.writeFile(path.join(output, 'map-manifest.json'), JSON.stringify(manifest));
await fs.mkdir(path.join(output, 'fonts'), { recursive: true });
await fs.copyFile(
  path.join(root, 'apps/web/assets/fangyu-seal.woff2'),
  path.join(output, 'fonts/fangyu-seal.woff2'),
);
await fs.writeFile(path.join(output, '.stamp'), stamp);
console.log('Prepared compressed catalog, boundary tiles, simplified maps and legacy badge font.');
