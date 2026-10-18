import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Converter } from 'opencc-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const toSimplified = Converter({ from: 'tw', to: 'cn' });
const sourceVersion = 'legacy-mixed-2026-10-03-to-10-04';
const osmRoot = path.join(root, 'data/boundaries/china-osm');
const policyRoot = path.join(root, 'data/boundaries/china-policy');
const manualRoot = path.join(root, 'data/manual/china');
const outputRoot = path.join(manualRoot, 'boundaries');
const readJson = async (filename) => JSON.parse(await fs.readFile(filename, 'utf8'));
const writeJson = async (filename, value) => {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(value) + '\n');
};
const hashFile = async (filename) => {
  const hash = createHash('sha256');
  for await (const chunk of await fs.open(filename).then((file) => file.createReadStream())) hash.update(chunk);
  return hash.digest('hex');
};
const toRegionLevel = (level) => ({ 0: 'province', 1: 'city', 2: 'county' })[level] ?? 'international';
const lineParts = (geometry) => {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  if (geometry?.type === 'GeometryCollection') return geometry.geometries.flatMap(lineParts);
  return [];
};
const lineKey = (coordinates) => {
  const forward = JSON.stringify(coordinates);
  const reverse = JSON.stringify([...coordinates].reverse());
  return forward < reverse ? forward : reverse;
};
const canonicalRing = (ring) => {
  const open = ring.slice(0, -1);
  if (!open.length) return { coordinates: ring, direction: 1 };
  const rotateToLeast = (points) => {
    let index = 0;
    let least = JSON.stringify(points[0]);
    for (let i = 1; i < points.length; i++) {
      const key = JSON.stringify(points[i]);
      if (key < least) {
        index = i;
        least = key;
      }
    }
    const candidates = points
      .map((point, i) => (JSON.stringify(point) === JSON.stringify(points[index]) ? i : -1))
      .filter((i) => i >= 0);
    const rotations = candidates.map((start) => [...points.slice(start), ...points.slice(0, start)]);
    rotations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return rotations[0];
  };
  const forward = rotateToLeast(open);
  const backward = rotateToLeast([...open].reverse());
  const forwardKey = JSON.stringify(forward);
  const backwardKey = JSON.stringify(backward);
  const coordinates = (forwardKey <= backwardKey ? forward : backward);
  coordinates.push(coordinates[0]);
  return { coordinates, direction: forwardKey <= backwardKey ? 1 : -1 };
};

const [catalog, assetLibrary, options, patches, published, edits, seaLines] = await Promise.all([
  readJson(path.join(root, 'data/catalog/catalog.json')),
  readJson(path.join(manualRoot, 'rules/boundary-assets.json')),
  readJson(path.join(manualRoot, 'rules/boundary-options.json')),
  readJson(path.join(policyRoot, 'reviewed-patches.json')),
  readJson(path.join(policyRoot, 'published-overrides.json')),
  readJson(path.join(manualRoot, 'rules/boundary-edits.json')),
  readJson(path.join(policyRoot, 'south-china-sea-lines.geojson')),
]);
const regions = catalog.regions.filter((region) => region.scope === 'china' && !region.historical);
const regionByCode = new Map(regions.filter((region) => region.code).map((region) => [region.code, region]));
const regionById = new Map(regions.map((region) => [region.id, region]));
const regionsByName = new Map();
for (const region of regions) {
  for (const name of [region.name, ...(region.aliases ?? [])]) {
    const normalized = toSimplified(name).trim();
    const candidates = regionsByName.get(normalized) ?? new Set();
    candidates.add(region);
    regionsByName.set(normalized, candidates);
  }
}

const sourceFiles = (await fs.readdir(osmRoot)).filter((name) => /^\d{6}\.geojson$/.test(name)).sort();
const osmFiles = [];
const osmRows = [];
const unresolvedOsm = [];
const relationRows = new Map();
for (const name of sourceFiles) {
  const filename = path.join(osmRoot, name);
  const reportPath = filename + '.report.json';
  const [collection, report, sha256] = await Promise.all([
    readJson(filename),
    fs.readFile(reportPath, 'utf8').then(JSON.parse).catch(() => null),
    hashFile(filename),
  ]);
  const relationMap = new Map((report?.mapped ?? []).map((entry) => [entry.relation, entry]));
  osmFiles.push({
    path: path.relative(root, filename).replaceAll('\\', '/'),
    sha256,
    reportPath: report ? path.relative(root, reportPath).replaceAll('\\', '/') : null,
    sourceTimestamp: report?.provenance?.sourceTimestamp ?? null,
    featureCount: collection.features?.length ?? 0,
  });
  for (const feature of collection.features ?? []) {
    const relationId = feature.id?.startsWith('relation/') ? feature.id : null;
    const mapping = relationMap.get(relationId);
    const code = feature.properties?.['ref:admin:CN'] ?? feature.properties?.division_code ?? mapping?.code;
    const chineseName = feature.properties?.['name:zh-Hans']
      ?? feature.properties?.['name:zh']
      ?? feature.properties?.name
      ?? mapping?.name;
    const nameCandidates = regionsByName.get(toSimplified(chineseName ?? '').trim());
    const adminLevel = feature.properties?.admin_level;
    const expectedLevel = adminLevel === '4' ? 'province' : adminLevel === '5' ? 'city' : adminLevel === '6' ? 'county' : null;
    const levelCandidates = nameCandidates && expectedLevel
      ? [...nameCandidates].filter((candidate) => toRegionLevel(candidate.level) === expectedLevel)
      : [];
    const region = (mapping?.regionId ? regionById.get(mapping.regionId) : null)
      ?? regionByCode.get(code)
      ?? (levelCandidates.length === 1 ? levelCandidates[0] : null)
      ?? (nameCandidates?.size === 1 ? [...nameCandidates][0] : null);
    const row = {
      sourceFile: path.relative(root, filename).replaceAll('\\', '/'),
      relationId,
      regionId: region?.id ?? mapping?.regionId ?? null,
      regionName: region?.name ?? mapping?.name ?? feature.properties?.['name:zh-Hans'] ?? feature.properties?.['name:zh'] ?? feature.properties?.name ?? null,
      level: region ? toRegionLevel(region.level) : mapping?.level ?? null,
      geometryType: feature.geometry?.type ?? null,
      topologyState: 'polygon-only-unshared',
      requiresRawRelationWays: true,
    };
    osmRows.push(row);
    if (relationId) relationRows.set(relationId, row);
    if (!row.regionId) unresolvedOsm.push(row);
  }
}

const arcs = [];
const seenLines = new Map();
const assetPaths = new Map();
const assetArcIds = new Map();
const addLine = (coordinates, fields) => {
  const key = lineKey(coordinates);
  const forwardKey = JSON.stringify(coordinates);
  const direction = forwardKey === key ? 1 : -1;
  const existing = seenLines.get(key);
  if (existing) {
    existing.displayAt = [...new Set([...(existing.displayAt ?? []), ...(fields.displayAt ?? [])])];
    existing.sourceRefs = [...new Set([...(existing.sourceRefs ?? []), ...(fields.sourceRefs ?? [])])];
    existing.adjacentRegionIds = [...new Set([...(existing.adjacentRegionIds ?? []), ...(fields.adjacentRegionIds ?? [])])];
    existing.regionUses = [...(existing.regionUses ?? []), ...(fields.regionUses ?? [])
      .map((usage) => ({ ...usage, sourceMemberDirection: direction }))];
    return { id: existing.id, direction };
  }
  const id = fields.id;
  const arc = {
    id,
    geometry: { type: 'LineString', coordinates: direction === 1 ? coordinates : [...coordinates].reverse() },
    ...fields,
    regionUses: (fields.regionUses ?? []).map((usage) => ({ ...usage, sourceMemberDirection: direction })),
  };
  arcs.push(arc);
  seenLines.set(key, arc);
  return { id, direction };
};
const addPolygonPaths = (geometry, sourceRef) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const polygonPaths = polygons.map((rings) => rings.map((ring, ringIndex) => {
    const canonical = canonicalRing(ring);
    const id = `legacy-asset/${createHash('sha256').update(JSON.stringify(canonical.coordinates)).digest('hex').slice(0, 24)}`;
    if (!assetArcIds.has(id)) {
      arcs.push({
        id,
        geometry: { type: 'LineString', coordinates: canonical.coordinates },
        level: 'county',
        leftRegionId: null,
        rightRegionId: null,
        origin: 'legacy-derived',
        updatePolicy: 'fixed',
        sourceVersion: null,
        sourceRefs: [sourceRef],
        matchable: false,
        lineOnly: false,
        status: 'migration-pending',
        role: ringIndex === 0 ? 'outer-ring' : 'inner-ring',
      });
      assetArcIds.set(id, true);
    }
    return {
      role: ringIndex === 0 ? 'outer' : 'inner',
      arcs: [{ arcId: id, direction: canonical.direction }],
    };
  }));
  return { type: 'PolygonPathSet', geometryType: geometry.type, polygons: polygonPaths.map((rings) => ({ rings })) };
};

const rawGeometryFiles = (await fs.readdir(path.join(osmRoot, 'raw')))
  .filter((name) => /^geom-\d{6}-\d+\.json$/.test(name))
  .sort();
const regionBoundaries = new Map();
let osmWayArcCount = 0;
for (const name of rawGeometryFiles) {
  const collection = await readJson(path.join(osmRoot, 'raw', name));
  const relations = (collection.elements ?? []).filter((element) => element.type === 'relation');
  for (const relation of relations) {
    const sourceRelationId = `relation/${relation.id}`;
    const row = relationRows.get(sourceRelationId);
    if (!row?.regionId) continue;
    const ways = (relation.members ?? []).filter((member) => member.type === 'way' && member.geometry?.length >= 2);
    const refs = [];
    for (const member of ways) {
      const coordinates = member.geometry.map(({ lon, lat }) => [lon, lat]);
      const arc = addLine(coordinates, {
        id: `osm/way/${member.ref}`,
        level: row.level ?? 'county',
        leftRegionId: null,
        rightRegionId: null,
        adjacentRegionIds: [row.regionId],
        origin: 'osm',
        updatePolicy: 'osm',
        sourceVersion,
        sourceRefs: [sourceRelationId, `way/${member.ref}`],
        regionUses: [{ regionId: row.regionId, role: member.role || 'outer' }],
        matchable: true,
        lineOnly: false,
        status: 'source-member-unoriented',
      });
      refs.push({ arcId: arc.id, role: member.role || 'outer', sourceMemberDirection: arc.direction });
      osmWayArcCount++;
    }
    regionBoundaries.set(row.regionId, {
      regionId: row.regionId,
      level: row.level,
      relationSource: sourceRelationId,
      sourceVersion,
      memberWays: refs,
      topologyState: 'member-ways-unoriented',
    });
  }
}

for (const [geometryId, geometry] of Object.entries(assetLibrary.geometries ?? {})) {
  if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) continue;
  assetPaths.set(geometryId, addPolygonPaths(geometry, `data/manual/china/rules/boundary-assets.json#geometries/${geometryId}`));
}
const relationIdsWithWays = new Set([...regionBoundaries.values()].map((boundary) => boundary.relationSource));
for (const row of osmRows) {
  row.topologyState = relationIdsWithWays.has(row.relationId)
    ? 'member-ways-unoriented'
    : 'polygon-only-unshared';
}

const seaGeometry = seaLines.features?.find((feature) => feature.properties?.gb === '156990000')?.geometry
  ?? seaLines.features?.[0]?.geometry;
const seaArcIds = [];
for (const [index, coordinates] of lineParts(seaGeometry).entries()) {
  const arc = addLine(coordinates, {
    id: `fixed/south-china-sea/${String(index + 1).padStart(2, '0')}`,
    level: 'international',
    leftRegionId: null,
    rightRegionId: null,
    origin: 'external-fixed',
    updatePolicy: 'fixed',
    sourceVersion: null,
    sourceRefs: ['data/boundaries/china-policy/south-china-sea-lines.geojson'],
    matchable: false,
    lineOnly: true,
    boundaryKind: 'maritime-dash',
    displayAt: ['county', 'city', 'province'],
    status: 'active',
  });
  seaArcIds.push(arc.id);
}

const tanggulaArcIds = new Set();
for (const group of assetLibrary.lineGroups ?? []) {
  for (const features of Object.values(group.variants ?? {})) {
    for (const feature of features) {
      const geometry = assetLibrary.geometries[feature.geometry];
      for (const [index, coordinates] of lineParts(geometry).entries()) {
        const arc = addLine(coordinates, {
          id: `fixed/tanggula-nominal/${index + 1}`,
          level: 'province',
          leftRegionId: 'CN630000',
          rightRegionId: 'CN540000',
          origin: 'external-fixed',
          updatePolicy: 'fixed',
          sourceVersion: null,
          sourceRefs: [`data/manual/china/rules/boundary-assets.json#geometries/${feature.geometry}`],
          matchable: false,
          lineOnly: true,
          boundaryKind: 'nominal',
          displayAt: [feature.displayAt],
          status: 'active',
          name: feature.name,
        });
        tanggulaArcIds.add(arc.id);
      }
    }
  }
}

const profileOptions = (options.options ?? []).map((option) => ({
  id: option.key,
  name: option.name,
  enabledByDefault: Boolean(options.default?.[option.key]),
  regionIds: option.ids,
  targetRegionId: option.target,
  enabledTargetRegionId: option.enabledTarget ?? null,
  hiddenWhenEnabled: option.hiddenWhenEnabled ?? [],
  enabledLabel: option.on ?? null,
  disabledLabel: option.off ?? null,
  legacyGeometryGroup: (assetLibrary.groups ?? []).find((group) => group.keys.includes(option.key))?.keys ?? [],
  migrationState: 'pending-face-and-edge-classification',
}));
const profileGroups = (assetLibrary.groups ?? []).map((group) => ({
  keys: group.keys,
  regionIds: group.regionIds,
  variants: Object.fromEntries(Object.entries(group.variants ?? {}).map(([state, features]) => [state, features.map((feature) => ({
    regionId: feature.regionId,
    level: feature.level,
    name: feature.name,
    bounds: feature.bounds,
    geometryPath: assetPaths.get(feature.geometry) ?? null,
    legacyGeometryId: feature.geometry,
    migrationState: 'awaiting-osm-edge-diff',
  }))])),
}));

const migrationConflicts = [
  ...published.map((row) => ({
    id: `published/${row.id}`,
    sourceFile: 'data/boundaries/china-policy/published-overrides.json',
    legacyId: row.id,
    regionId: row.regionId,
    level: row.level,
    state: 'needs-source-edge-diff',
    blocking: true,
  })),
  ...patches.map((row, index) => ({
    id: `patch/${row.regionId}/${index + 1}`,
    sourceFile: 'data/boundaries/china-policy/reviewed-patches.json',
    regionId: row.regionId,
    level: row.level,
    state: 'needs-source-edge-diff-and-face-classification',
    blocking: true,
  })),
  ...edits.map((row, index) => ({
    id: `edit/${row.regionId}/${index + 1}`,
    sourceFile: 'data/manual/china/rules/boundary-edits.json',
    regionId: row.regionId,
    level: regionById.get(row.regionId) ? toRegionLevel(regionById.get(row.regionId).level) : null,
    reason: row.reason,
    state: 'needs-semantic-classification',
    blocking: false,
  })),
  {
    id: 'datav/baiyun-damao',
    sourceFile: 'data/boundaries/china-osm/raw/datav-150206.json',
    regionIds: ['CN150206', 'CN150223'],
    state: 'needs-source-edge-diff',
    blocking: true,
    reason: 'The existing build hook replaces complete region geometries; only changed shared edge portions can be activated.',
  },
  ...unresolvedOsm.map((row, index) => ({
    id: `osm-unmapped/${index + 1}`,
    sourceFile: row.sourceFile,
    relationId: row.relationId,
    regionName: row.regionName,
    state: 'needs-region-mapping',
    blocking: true,
  })),
];

const pendingAssets = Object.entries(assetLibrary.geometries ?? {}).map(([geometryId, geometry]) => ({
  id: geometryId,
  sourceFile: 'data/manual/china/rules/boundary-assets.json',
  geometryType: geometry.type,
  geometryPath: assetPaths.get(geometryId) ?? null,
  usage: [],
  state: 'needs-source-diff-or-profile-reference',
}));
for (const group of assetLibrary.groups ?? []) {
  for (const [variant, features] of Object.entries(group.variants ?? {})) {
    for (const feature of features) {
      const asset = pendingAssets.find((entry) => entry.id === feature.geometry);
      asset?.usage.push({ groupKeys: group.keys, variant, regionId: feature.regionId, level: feature.level });
    }
  }
}
for (const group of assetLibrary.lineGroups ?? []) {
  for (const [variant, features] of Object.entries(group.variants ?? {})) {
    for (const feature of features) {
      const asset = pendingAssets.find((entry) => entry.id === feature.geometry);
      asset?.usage.push({ groupKeys: group.keys, variant, regionId: feature.regionId, level: feature.level, displayAt: feature.displayAt });
    }
  }
}

const dataV = await readJson(path.join(osmRoot, 'raw/datav-150206.json'));
const dataVMeta = await readJson(path.join(osmRoot, 'raw/datav-150206.meta.json'));
let dataVPathSet = null;
const dataVFeature = dataV.type === 'Feature'
  ? dataV
  : dataV.features?.find((feature) => String(feature.properties?.adcode) === '150206');
if (dataVFeature?.geometry && ['Polygon', 'MultiPolygon'].includes(dataVFeature.geometry.type)) {
  dataVPathSet = addPolygonPaths(dataVFeature.geometry, 'data/boundaries/china-osm/raw/datav-150206.json');
  const arcIds = dataVPathSet.polygons.flatMap((polygon) => polygon.rings.flatMap((ring) => ring.arcs.map((ref) => ref.arcId)));
  migrationConflicts.splice(migrationConflicts.findIndex((item) => item.id === 'datav/baiyun-damao'), 1);
  migrationConflicts.push({
    id: 'datav/baiyun-damao',
    sourceFile: 'data/boundaries/china-osm/raw/datav-150206.json',
    regionIds: ['CN150206', 'CN150223'],
    state: 'fixed-ring-imported-source-window-pending',
    blocking: true,
    reason: 'WGS84 DataV ring is imported; the corresponding OSM source windows still need member-way matching.',
  });
  for (const arcId of arcIds) {
    const arc = arcs.find((candidate) => candidate.id === arcId);
    if (!arc) continue;
    arc.origin = 'external-fixed';
    arc.sourceVersion = null;
    arc.sourceRefs = [
      'data/boundaries/china-osm/raw/datav-150206.json',
      `originalSha256:${dataVMeta.originalSha256}`,
      `processedSha256:${dataVMeta.sha256}`,
      `coordinateReferenceSystem:${dataVMeta.coordinateReferenceSystem}`,
      `transformation:${dataVMeta.transformation}`,
    ];
    arc.level = 'county';
    arc.leftRegionId = 'CN150206';
    arc.rightRegionId = 'CN150223';
    arc.lineOnly = false;
    arc.boundaryKind = 'administrative';
    arc.status = 'pending-source-window-match';
  }
}

await fs.mkdir(outputRoot, { recursive: true });
await writeJson(path.join(outputRoot, 'boundary-arcs.json'), { schemaVersion: 1, arcs });
await writeJson(path.join(outputRoot, 'boundary-paths.json'), {
  schemaVersion: 1,
  arcs: Object.fromEntries(arcs.map((arc) => [arc.id, arc.geometry])),
  profiles: profileGroups,
  fixedPaths: [
    {
      id: 'china-south-china-sea-maritime-dash',
      arcIds: seaArcIds,
      leftRegionId: null,
      rightRegionId: null,
      boundaryKind: 'maritime-dash',
      name: '南海段线',
      displayAt: ['county', 'city', 'province'],
      settingKeys: [],
      matchable: false,
      sourceRefs: ['data/boundaries/china-policy/south-china-sea-lines.geojson'],
      status: 'active',
    },
    {
      id: 'china-tanggula-nominal-line',
      arcIds: [...tanggulaArcIds],
      leftRegionId: 'CN630000',
      rightRegionId: 'CN540000',
      boundaryKind: 'nominal',
      name: '青海省／西藏自治区名义界',
      settingKeys: ['tanggulaTibet'],
      matchable: false,
      displayAt: ['county', 'city', 'province'],
      sourceRefs: ['data/manual/china/rules/boundary-assets.json'],
      status: 'active',
    },
    ...(dataVPathSet ? [{
      id: 'datav-baiyun-damao-fixed-boundary',
      geometry: dataVPathSet,
      applications: [{ level: 'county', regionIds: ['CN150206', 'CN150223'] }],
      matchable: false,
      sourceRefs: [
        'data/boundaries/china-osm/raw/datav-150206.json',
        `originalSha256:${dataVMeta.originalSha256}`,
        `processedSha256:${dataVMeta.sha256}`,
        `coordinateReferenceSystem:${dataVMeta.coordinateReferenceSystem}`,
        `transformation:${dataVMeta.transformation}`,
      ],
      status: 'pending-source-window-match',
    }] : []),
  ],
});
await writeJson(path.join(outputRoot, 'region-boundaries.json'), {
  schemaVersion: 1,
  sourceVersion,
  regions: [...regionBoundaries.values()],
});
await writeJson(path.join(outputRoot, 'edge-overrides.json'), { schemaVersion: 1, overrides: [] });
await writeJson(path.join(outputRoot, 'edge-policies.json'), {
  schemaVersion: 1,
  endpointSnapMeters: 10,
  sourceMatchOrder: ['osm-object-id', 'adjacent-region-pair-and-geometry-fingerprint'],
  ambiguousMatch: 'conflict-no-publish',
  fixedArcUpdatePolicy: 'never-refresh-from-network',
});
await writeJson(path.join(outputRoot, 'profiles/boundary-profiles.json'), {
  schemaVersion: 1,
  defaultProfileId: 'china-default',
  profiles: [{ id: 'china-default', name: '中国默认边界展示', options: profileOptions }],
});
const profileData = await readJson(path.join(outputRoot, 'profiles/boundary-profiles.json'));
const webProfiles = profileGroups.map((group) => ({
  keys: group.keys,
  regionIds: group.regionIds,
  variants: Object.fromEntries(Object.entries(group.variants).map(([key, rows]) => [key, rows.flatMap((row) => {
    const pathSet = row.geometryPath;
    if (!pathSet) return [];
    const pathId = `profile/${group.keys.join('+')}/${key}/${row.regionId}`;
    const pathSetIndex = new Map();
    const pathKey = JSON.stringify(pathSet);
    if (!pathSetIndex.has(pathKey)) {
      pathSetIndex.set(pathKey, pathId);
      fixedPaths[pathId] = pathSet;
    }
    return [{ regionId: row.regionId, level: row.level, name: row.name, pathId: pathSetIndex.get(pathKey), bounds: row.bounds }];
  })])),
}));
const webPaths = {};
for (const group of profileGroups) for (const [key, rows] of Object.entries(group.variants)) for (const row of rows) {
  const pathSet = row.geometryPath;
  if (!pathSet) continue;
  const pathId = `profile/${group.keys.join('+')}/${key}/${row.regionId}`;
  webPaths[pathId] = pathSet;
}
await writeJson(path.join(outputRoot, 'web-boundary-graph.json'), {
  schemaVersion: 2,
  arcs: Object.fromEntries(arcs.map((arc) => [arc.id, arc.geometry])),
  paths: webPaths,
  profiles: webProfiles,
  fixedPaths: [
    { id: 'china-south-china-sea-maritime-dash', name: '南海段线', arcIds: seaArcIds, boundaryKind: 'maritime-dash', displayAt: ['county', 'city', 'province'], settingKeys: [] },
    { id: 'china-tanggula-nominal-line', name: '青海省／西藏自治区名义界', arcIds: [...tanggulaArcIds], boundaryKind: 'nominal', displayAt: ['county', 'city', 'province'], settingKeys: ['tanggulaTibet'] },
  ],
});
await writeJson(path.join(outputRoot, 'migration-conflicts.json'), { schemaVersion: 1, conflicts: migrationConflicts });
await writeJson(path.join(outputRoot, 'pending-assets.json'), { schemaVersion: 1, assets: pendingAssets });
await writeJson(path.join(outputRoot, `source-versions/${sourceVersion}/source-index.json`), {
  schemaVersion: 1,
  sourceVersion,
  state: 'legacy-mixed-read-only-reference',
  sourceFiles: osmFiles,
  regions: osmRows,
  topologyState: 'polygon-only-unshared',
  requiredNextInput: 'raw Overpass relation member ways with node coordinates for shared-arc construction',
  rawGeometryFiles,
  rawGeometryState: rawGeometryFiles.length ? 'partial-relation-members' : 'missing',
});
await writeJson(path.join(outputRoot, 'migration-manifest.json'), {
  schemaVersion: 1,
  migrationVersion: 'shared-edge-seed-2026-10-15',
  state: 'partial-migration',
  completed: ['fixed line-only arcs', 'boundary option profile index', 'OSM legacy source index', 'cached Overpass way member arcs', 'legacy polygon ring paths', 'DataV WGS84 fixed ring import'],
  pending: ['OSM relation ways and shared topology', 'whole-region geometry edge diff', 'face assignment classification', 'legacy source cleanup'],
  counts: {
    osmFiles: osmFiles.length,
    osmFeatures: osmRows.length,
    osmUnmappedFeatures: unresolvedOsm.length,
    totalArcs: arcs.length,
    osmWayArcs: arcs.filter((arc) => arc.origin === 'osm').length,
    legacyRingArcs: arcs.filter((arc) => arc.origin === 'legacy-derived').length,
    fixedLineArcs: arcs.filter((arc) => arc.lineOnly && arc.origin === 'external-fixed').length,
    osmWayMemberArcs: osmWayArcCount,
    regionsWithMemberWays: regionBoundaries.size,
    regionsWithoutMemberWays: osmRows.filter((row) => row.topologyState === 'polygon-only-unshared').length,
    profileOptions: profileOptions.length,
    pendingLegacyGeometries: pendingAssets.length,
    migratedLegacyRingPaths: assetPaths.size,
    dataVFixedArcPaths: dataVFeature?.geometry ? 1 : 0,
    blockingGeometryConflicts: migrationConflicts.filter((item) => item.blocking).length,
  },
});

console.log(JSON.stringify({
  output: path.relative(root, outputRoot).replaceAll('\\', '/'),
  osmFiles: osmFiles.length,
  osmFeatures: osmRows.length,
  osmUnmapped: unresolvedOsm.length,
  totalArcs: arcs.length,
  osmWayArcs: arcs.filter((arc) => arc.origin === 'osm').length,
  legacyRingArcs: arcs.filter((arc) => arc.origin === 'legacy-derived').length,
  fixedLineArcs: arcs.filter((arc) => arc.lineOnly && arc.origin === 'external-fixed').length,
  osmWayMemberArcs: osmWayArcCount,
  regionsWithMemberWays: regionBoundaries.size,
  profileOptions: profileOptions.length,
  pendingGeometryAssets: pendingAssets.length,
  conflicts: migrationConflicts.length,
}, null, 2));
