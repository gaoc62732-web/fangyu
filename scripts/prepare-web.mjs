import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import simplify from '@turf/simplify';
import ts from 'typescript';
import { PMTilesWriter } from './lib/pmtiles-writer.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const chinaPolicy = await fs
  .readFile(path.join(root, 'data/boundaries/china-policy/applied.json'), 'utf8')
  .catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
if (chinaPolicy) {
  const policy = JSON.parse(chinaPolicy);
  const bytes = await fs.readFile(path.join(root, 'data/catalog/china.geo.json'));
  if (createHash('sha256').update(bytes).digest('hex') !== policy.geometrySha256) {
    throw Error(
      'China reviewed geometry changed: re-audit the China boundary policy before rebuilding maps.',
    );
  }
}
const input = path.join(root, 'data/catalog'),
  output = path.join(root, 'data/generated/web');
const tileRoot = path.resolve(output, 'tiles');
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
function manifestTileFiles(manifest) {
  const files = new Set();
  const add = (url) => {
    if (typeof url !== 'string' || !url.startsWith('tiles/'))
      throw Error(`Unexpected tile URL in manifest: ${url}`);
    const target = path.resolve(output, ...url.split('/'));
    if (target !== tileRoot && !target.startsWith(tileRoot + path.sep))
      throw Error(`Tile URL escapes generated tile directory: ${url}`);
    files.add(target);
  };
  for (const scope of Object.values(manifest.scopes || {})) {
    for (const layer of scope.layers || []) {
      if (layer.archive) {
        add(layer.url);
        continue;
      }
      if (!Number.isInteger(layer.maxzoom) || !Array.isArray(layer.bounds))
        throw Error('Tile template is missing zoom or bounds metadata.');
      for (let z = 0; z <= layer.maxzoom; z++) {
        const nw = tileXY(layer.bounds[0], layer.bounds[3], z);
        const se = tileXY(layer.bounds[2], layer.bounds[1], z);
        for (let x = nw[0]; x <= se[0]; x++)
          for (let y = nw[1]; y <= se[1]; y++)
            add(
              layer.url
                .replace('{z}', String(z))
                .replace('{x}', String(x))
                .replace('{y}', String(y)),
            );
      }
    }
  }
  return files;
}
async function missingManifestTiles(manifest) {
  const missing = [];
  for (const target of manifestTileFiles(manifest)) {
    try {
      if (!(await fs.stat(target)).isFile()) missing.push(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(target);
    }
  }
  return missing;
}
async function pruneStaleTiles(manifest) {
  const referenced = manifestTileFiles(manifest);
  const missing = await missingManifestTiles(manifest);
  if (missing.length)
    throw Error(`Refusing to prune tiles: manifest references ${missing.length} missing files.`);
  const removed = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const target = path.resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        if ((await fs.readdir(target)).length === 0) await fs.rmdir(target);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.tmp') || !referenced.has(target)) {
          await fs.rm(target);
          removed.push(target);
        }
      } else {
        throw Error(`Unexpected non-file entry in generated tile directory: ${target}`);
      }
    }
  }
  await visit(tileRoot);
  return removed;
}
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
const boundaryOptions = availableFiles.has('china-boundary-options.json')
  ? await fs.readFile(path.join(input, 'china-boundary-options.json'))
  : null;
// The policy asset has five independently rendered rule groups. Keep this
// count here to avoid parsing its large geometry bank during web preparation.
const boundaryOptionGroups = boundaryOptions ? 5 : 0;
if (boundaryOptions) sourceNames.push('china-boundary-options.json');
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
hash.update(await fs.readFile(new URL('./lib/pmtiles-writer.mjs', import.meta.url)));
hash.update(vietnamMaskBytes);
hash.update(registrySource);
hash.update(JSON.stringify(sourceNames));
for (const name of sourceNames) hash.update(await fs.readFile(path.join(input, name)));
const stamp = hash.digest('hex');
if ((await fs.readFile(path.join(output, '.stamp'), 'utf8').catch(() => null)) === stamp) {
  const currentManifest = await fs
    .readFile(path.join(output, 'map-manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (currentManifest?.version === stamp) {
    const missing = await missingManifestTiles(currentManifest);
    if (!missing.length) {
      const removed = await pruneStaleTiles(currentManifest);
      if (removed.length) console.log(`Removed ${removed.length} unreferenced tile files.`);
      console.log('Web assets are current.');
      process.exit(0);
    }
    console.warn(`Rebuilding ${missing.length} tile files missing from the current manifest.`);
  }
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
// The outer line comes from these exact district polygons, so it cannot jump
// across islands when the lower-resolution world outline differs from them.
const malayBorderScopes = new Set(['malaysia', 'singapore', 'brunei']);
function countryBorder(rows, scope) {
  const rings = rows.flatMap((row) => {
    const geometry = row.geometry;
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];
    return polygons.flat();
  });
  const key = (a, b) => {
    const point = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const left = point(a),
      right = point(b);
    return left < right ? `${left}|${right}` : `${right}|${left}`;
  };
  const counts = new Map();
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const edge = key(ring[i - 1], ring[i]);
      counts.set(edge, (counts.get(edge) || 0) + 1);
    }
  const lines = [];
  for (const ring of rings) {
    let line = [];
    for (let i = 1; i < ring.length; i++) {
      if (counts.get(key(ring[i - 1], ring[i])) === 1) {
        if (!line.length) line.push(ring[i - 1]);
        line.push(ring[i]);
      } else if (line.length) {
        lines.push(line);
        line = [];
      }
    }
    if (line.length) lines.push(line);
  }
  if (!lines.length) throw Error(`No exterior border segments for ${scope}.`);
  return {
    id: `border-${scope}`,
    regionId: `border-${scope}`,
    level: 'border',
    geometry: { type: 'MultiLineString', coordinates: lines },
  };
}
const manifest = {
  version: stamp,
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
for (const scope of scopes) {
  const raw = JSON.parse(await fs.readFile(path.join(input, scope + '.geo.json'), 'utf8'));
  const display =
    scope === 'vietnam'
      ? vietnamDisplay
      : malayBorderScopes.has(scope)
        ? [...raw, countryBorder(raw, scope)]
        : raw;
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
        ...(f.boundaryKind ? { boundaryKind: f.boundaryKind } : {}),
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
          scope === 'china'
            ? 0.000002
            : scope === 'france' && f.properties.level === 'county'
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
  const simplifiedLevels = {};
  if (scope === 'china') {
    // Export only needs the selected administrative level. Keep original
    // detail without asking the browser to parse every county for a province PNG.
    for (const level of ['province', 'city', 'county']) {
      const filename = `maps/china-${level}.json`;
      await fs.writeFile(
        path.join(output, filename),
        JSON.stringify({
          type: 'FeatureCollection',
          features: simple.features.filter(
            (f) => f.properties.level === level || f.properties.level === 'border',
          ),
        }),
      );
      simplifiedLevels[level] = filename;
    }
  }
  const layers = [];
  for (const level of [...new Set(display.map((f) => f.level))]) {
    const selected = features.filter((f) => f.properties.level === level);
    const maxzoom =
      scope === 'china'
        ? 12
        : scope === 'france' && level === 'county'
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
        tolerance: scope === 'china' ? 1 : 2,
        extent: scope === 'china' ? 8192 : 4096,
        buffer: 64,
        promoteId: 'regionId',
      },
    );
    let count = 0;
    if (scope === 'china') {
      // An active Windows map can retain a read handle to the previous archive.
      // Publish under its content version so fresh coastlines never reuse it.
      const archiveName = `${level}-${stamp.slice(0, 16)}.pmtiles`;
      const archivePath = path.join(output, 'tiles', scope, archiveName);
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      const archive = new PMTilesWriter(archivePath);
      // Traverse non-empty parents only. Missing tiles are encoded as absent
      // directory entries; the PMTiles protocol returns an empty tile, not 404.
      function visit(z, x, y) {
        const tile = index.getTile(z, x, y);
        if (!tile?.numPoints) return;
        if (tile.features.length)
          archive.add(z, x, y, vtpbf.fromGeojsonVt({ regions: tile }, { extent: 8192 }));
        if (z < maxzoom)
          for (let dx = 0; dx < 2; dx++)
            for (let dy = 0; dy < 2; dy++) visit(z + 1, x * 2 + dx, y * 2 + dy);
      }
      visit(0, 0, 0);
      count = archive.finish({
        bounds,
        maxzoom,
        metadata: {
          name: `China ${level}`,
          attribution:
            '© OpenStreetMap contributors · ODbL 1.0; land coastline: original OSM natural=coastline; reviewed edges and maritime dashes: TianDiTu; see China boundary review report',
          vector_layers: [
            {
              id: 'regions',
              fields: { regionId: 'String', level: 'String', name: 'String' },
              minzoom: 0,
              maxzoom,
            },
          ],
        },
      });
      layers.push({
        level,
        maxzoom,
        bounds,
        archive: true,
        url: `tiles/${scope}/${archiveName}`,
      });
      console.log(`${scope}/${level}: ${count} tiles in one PMTiles archive`);
      continue;
    }
    for (let z = 0; z <= maxzoom; z++) {
      const nw = tileXY(bounds[0], bounds[3], z),
        se = tileXY(bounds[2], bounds[1], z);
      for (let x = nw[0]; x <= se[0]; x++) {
        const version = stamp.slice(0, 16);
        const folder = path.join(output, 'tiles', scope, version, level, String(z), String(x));
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
      url: `tiles/${scope}/${stamp.slice(0, 16)}/${level}/{z}/{x}/{y}.pbf`,
    });
    console.log(scope + '/' + level + ': ' + count + ' tiles');
  }
  manifest.scopes[scope] = {
    bounds: allBounds,
    regionBounds,
    layers,
    simplified: 'maps/' + scope + '.json',
    ...(scope === 'china' ? { simplifiedLevels } : {}),
    ...(scope === 'china' && boundaryOptions
      ? {
          boundaryOptions: 'maps/china-boundary-options.json.gz',
          boundaryOptionGroups,
        }
      : {}),
  };
}
if (boundaryOptions)
  await fs.writeFile(
    path.join(output, 'maps/china-boundary-options.json.gz'),
    gzipSync(boundaryOptions),
  );
const missingTiles = await missingManifestTiles(manifest);
if (missingTiles.length)
  throw Error(`Refusing to publish manifest: ${missingTiles.length} tile files are missing.`);
await fs.writeFile(path.join(output, 'map-manifest.json'), JSON.stringify(manifest));
const removedTiles = await pruneStaleTiles(manifest);
if (removedTiles.length) console.log(`Removed ${removedTiles.length} unreferenced tile files.`);
// Older local builds copied a font whose redistribution license was not established.
// Remove only this generated asset; personal configuration and source archives stay untouched.
await fs.rm(path.join(output, 'fonts/fangyu-seal.woff2'), { force: true });
await fs.writeFile(path.join(output, '.stamp'), stamp);
console.log('Prepared compressed catalog, boundary tiles and simplified maps.');
