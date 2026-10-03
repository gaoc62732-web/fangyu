import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import simplify from '@turf/simplify';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.join(root, 'data/catalog'),
  output = path.join(root, 'data/generated/web');
// Keep the registry as the only source of scope IDs. Transpile this dependency-free
// configuration so the script also works on Node 22.12 without native TS loading.
const registrySource = await fs.readFile(
  path.join(root, 'packages/contracts/src/scopes.ts'),
  'utf8',
);
const registryCode = ts.transpileModule(registrySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { SCOPE_IDS } = await import(
  'data:text/javascript;base64,' + Buffer.from(registryCode).toString('base64')
);
const availableFiles = new Set(await fs.readdir(input));
const scopes = SCOPE_IDS.filter((scope) => availableFiles.has(scope + '.geo.json'));
const sourceNames = ['catalog.json', ...scopes.map((s) => s + '.geo.json')];
const vietnamMaskBytes = await fs.readFile(
  path.join(root, 'data/extensions/research/south-china-sea-interaction-mask.json'),
);
const vietnamMask = JSON.parse(vietnamMaskBytes.toString('utf8'));
// Fail before writing assets if the reviewed snapshot or any exact component changed.
// This display policy never edits the catalog or its evidence copy under geometry/.
const vietnamBytes = await fs.readFile(path.join(input, 'vietnam.geo.json'));
const vietnamSnapshot = vietnamMask.sourceSnapshots.find((s) => s.scope === 'vietnam');
if (createHash('sha256').update(vietnamBytes).digest('hex') !== vietnamSnapshot?.sha256) {
  throw Error(
    'Vietnam geometry changed: re-audit the offshore component manifest before preparing maps.',
  );
}
const vietnamRaw = JSON.parse(vietnamBytes.toString('utf8'));
const vietnamRemoved = new Map();
for (const component of vietnamMask.polygons) {
  const row = vietnamRaw.find(
    (f) => f.id === component.geometryId && f.regionId === component.regionId,
  );
  const polygons =
    row?.geometry.type === 'MultiPolygon'
      ? row.geometry.coordinates
      : row?.geometry.type === 'Polygon'
        ? [row.geometry.coordinates]
        : [];
  if (
    !Number.isInteger(component.polygonIndex) ||
    JSON.stringify(polygons[component.polygonIndex]) !==
      JSON.stringify(component.geometry.coordinates)
  ) {
    throw Error(
      'Vietnam exclusion component no longer matches its reviewed index and coordinates.',
    );
  }
  const indexes = vietnamRemoved.get(row.id) || new Set();
  if (indexes.has(component.polygonIndex)) throw Error('Duplicate Vietnam exclusion component.');
  indexes.add(component.polygonIndex);
  vietnamRemoved.set(row.id, indexes);
}
if (vietnamMask.polygons.length !== 328) throw Error('Expected 328 reviewed Vietnam components.');
const vietnamDisplay = vietnamRaw.map((row) => {
  const removed = vietnamRemoved.get(row.id);
  if (!removed) return row;
  if (row.geometry.type !== 'MultiPolygon')
    throw Error('Expected reviewed multipart Vietnam geometry.');
  const coordinates = row.geometry.coordinates.filter((_, index) => !removed.has(index));
  if (!coordinates.length) throw Error('Vietnam display policy must not remove an entire region.');
  return { ...row, geometry: { ...row.geometry, coordinates } };
});
if (
  vietnamDisplay.reduce(
    (n, f) => n + (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.length : 1),
    0,
  ) !== 2375
) {
  throw Error('Expected 2375 retained Vietnam display components.');
}
const hash = createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url)));
hash.update(vietnamMaskBytes);
hash.update(registrySource);
hash.update(JSON.stringify(sourceNames));
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
const manifest = {
  version: catalog.version,
  scopes: {},
  unavailableScopes: SCOPE_IDS.filter((scope) => !scopes.includes(scope)),
};
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
  const display = scope === 'vietnam' ? vietnamDisplay : raw;
  await fs.mkdir(path.join(output, 'geometry'), { recursive: true });
  await fs.copyFile(
    path.join(input, scope + '.geo.json'),
    path.join(output, 'geometry', scope + '.geo.json'),
  );
  const regionBounds = {};
  let allBounds;
  const features = display.map((f) => {
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
        const tolerance =
          scope === 'france' && f.properties.level === 'county'
            ? 0.0001
            : scope === 'france' && f.properties.level === 'city'
              ? 0.001
              : scope === 'world'
                ? 0.06
                : ['singapore', 'brunei'].includes(scope)
                  ? 0.001
                  : 0.012;
        return simplify(f, { tolerance, highQuality: true });
      } catch {
        return f;
      }
    }),
  };
  await fs.mkdir(path.join(output, 'maps'), { recursive: true });
  await fs.writeFile(path.join(output, 'maps', scope + '.json'), JSON.stringify(simple));
  if (scope === 'vietnam') {
    // Remove stale offshore tiles from earlier generations, including tiles outside
    // the new bounds. The fixed, resolved target is confined to generated VN tiles.
    const vietnamTiles = path.resolve(output, 'tiles', 'vietnam');
    if (vietnamTiles !== path.resolve(root, 'data/generated/web/tiles/vietnam')) {
      throw Error('Unexpected Vietnam generated-tile target.');
    }
    await fs.rm(vietnamTiles, { recursive: true, force: true });
  }
  const layers = [];
  for (const level of [...new Set(display.map((f) => f.level))]) {
    const selected = features.filter((f) => f.properties.level === level);
    const maxzoom =
      scope === 'france' && level === 'county'
        ? 12
        : scope === 'france' && level === 'city'
          ? 9
          : scope === 'world'
            ? 3
            : scope === 'singapore'
              ? 10
              : scope === 'brunei'
                ? 8
                : level === 'county'
                  ? 7
                  : level === 'city'
                    ? 6
                    : 5;
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
// Older local builds copied a font whose redistribution license was not established.
// Remove only this generated asset; personal configuration and source archives stay untouched.
await fs.rm(path.join(output, 'fonts/fangyu-seal.woff2'), { force: true });
await fs.writeFile(path.join(output, '.stamp'), stamp);
console.log('Prepared compressed catalog, boundary tiles and simplified maps.');
