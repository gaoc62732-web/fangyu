// Offline geometry conversion and catalog matching. Network acquisition lives in Python.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import osmtogeojson from 'osmtogeojson';
import { Converter } from 'opencc-js';
import {
  removeHistoricalGeometry,
  retainReviewedChinaGeometry,
  recordReviewedChinaReimport,
} from './china-boundary-policy.mjs';
const toSimplified = Converter({ from: 'tw', to: 'cn' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = async (filename) => JSON.parse(await fs.readFile(filename, 'utf8'));
async function write(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const bytes = JSON.stringify(value) + '\n';
  await fs.writeFile(filename + '.tmp', bytes);
  // Windows indexers can briefly hold the destination while it is replaced.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(filename + '.tmp', filename);
      break;
    } catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
      await pause(300);
    }
  }
  return createHash('sha256').update(bytes).digest('hex');
}
const job = await read(process.argv[2]);
const catalog = await read(path.join(root, 'data/catalog/catalog.json'));
const regions = catalog.regions.filter((r) => r.scope === 'china');
const regionMap = new Map(regions.map((r) => [r.id, r]));
const geometryFile = path.join(root, 'data/catalog/china.geo.json');
const legacy = await read(geometryFile);
export function bounds(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  function walk(c) {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]);
      b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]);
      b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  }
  walk(geometry.coordinates);
  return b;
}
function overlap(a, b) {
  const area = (c) => (c[2] - c[0]) * (c[3] - c[1]);
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (w * h) / Math.min(area(a), area(b));
}
function valid(feature) {
  if (
    !feature ||
    feature.properties?.tainted ||
    !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
  )
    return false;
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return (
    polygons.length &&
    polygons.every(
      (p) =>
        p.length &&
        p.every(
          (ring) =>
            ring.length >= 4 &&
            ring.every(
              (v) =>
                v.length >= 2 &&
                v.every(Number.isFinite) &&
                Math.abs(v[0]) <= 180 &&
                Math.abs(v[1]) <= 90,
            ) &&
            ring[0][0] === ring.at(-1)[0] &&
            ring[0][1] === ring.at(-1)[1],
        ),
    )
  );
}
const names = (tags) =>
  new Set(
    ['name', 'name:zh', 'name:zh-Hans', 'official_name', 'alt_name', 'short_name']
      .flatMap((key) => (tags[key] || '').split(';'))
      // Bilingual Mongolian/Tibetan names sometimes omit a separate name:zh tag.
      .flatMap((name) => [name.trim(), name.match(/^[\p{Script=Han}]+/u)?.[0]])
      .filter(Boolean)
      .map((name) => toSimplified(name)),
  );
function provinceOf(region) {
  let r = region;
  while (r.parentId && regionMap.has(r.parentId)) r = regionMap.get(r.parentId);
  return r.id;
}
const elements = new Map();
for (const filename of job.inputs) {
  const response = await read(filename);
  for (const element of response.elements || [response]) {
    elements.set(`${element.type}/${element.id}`, element);
  }
}
const converted = osmtogeojson({ elements: [...elements.values()] }, { flatProperties: true });
const wanted = new Set(job.relationIds.map((id) => `relation/${id}`));
// A few HK suburb relations are explicitly marked Placeholder and contain only
// a label node. They never represented polygons, so record and exclude them.
const excludedPlaceholders = [...wanted].filter((id) => {
  const r = elements.get(id);
  return r?.tags?.note === 'Placeholder' && r.members?.every((m) => m.type === 'node');
});
excludedPlaceholders.forEach((id) => wanted.delete(id));
const features = converted.features.filter((f) => wanted.has(f.id) && valid(f));
const rejected = [...wanted].filter((id) => !features.some((f) => f.id === id));
const report = {
  acquiredAt: new Date().toISOString(),
  license: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors',
  source: 'https://www.openstreetmap.org/copyright',
  provenance: job.provenance,
  downloaded: features.length,
  rejected,
  excludedPlaceholders,
  applied: false,
};
// Incomplete relations must not silently publish just their surviving members.
if (rejected.length) {
  await write(job.output + '.report.json', report);
  throw Error(`Incomplete/missing polygons: ${rejected.join(', ')}`);
}
await write(job.output, { type: 'FeatureCollection', features });
if (job.kind === 'province') {
  const province = regions.find((r) => r.level === 0 && r.code === job.code);
  if (!province) throw Error('Unknown catalog province code');
  const mapped = [],
    unmatched = [],
    replacements = new Map();
  const codeOf = (f) => f.properties['ref:admin:CN'] || f.properties.division_code;
  for (const r of regions.filter((r) => !r.historical && provinceOf(r) === province.id)) {
    const previous = legacy.filter((g) => g.regionId === r.id && g.level !== 'border');
    const candidateNames = new Set([r.name, ...r.aliases].map(toSimplified));
    const parent = regionMap.get(r.parentId);
    const parents = parent
      ? features.filter((p) => names(p.properties).has(toSimplified(parent.name)))
      : [];
    const containedByParent = (f) =>
      parents.length === 1 && overlap(bounds(parents[0].geometry), bounds(f.geometry)) > 0.95;
    const isExplicitSubarea = (f) =>
      parents.length === 1 &&
      elements
        .get(parents[0].id)
        ?.members?.some(
          (m) => m.type === 'relation' && `relation/${m.ref}` === f.id && m.role === 'subarea',
        );
    const possible = features.filter((f) => {
      if (r.id === province.id) return f.id === `relation/${job.provinceRelation}`;
      const reviewed = job.reviewedMappings?.find((m) => m.code === r.code);
      if (reviewed)
        return (
          f.id === `relation/${reviewed.relation}` &&
          names(f.properties).has(reviewed.expectedName) &&
          f.properties.admin_level === reviewed.expectedAdminLevel &&
          f.properties['ISO3166-2'] === reviewed.expectedIso &&
          previous.some((old) => overlap(bounds(old.geometry), bounds(f.geometry)) > 0.5)
        );
      const nameMatches = [...names(f.properties)].some((n) => candidateNames.has(n));
      // Some adjacent OSM relations contain a duplicated division_code. A code
      // alone must not override a contradictory Chinese administrative name.
      if (!nameMatches) return false;
      if (
        !['710000', '810000', '820000'].includes(province.code) &&
        Number(f.properties.admin_level) !== (r.level === 1 ? 5 : 6)
      )
        return false;
      if (previous.length) {
        if (previous.some((old) => overlap(bounds(old.geometry), bounds(f.geometry)) > 0.5))
          return true;
        // A coarse legacy outline is not ground truth. A matching code, name,
        // level and explicit OSM parent membership can establish identity when
        // the old bbox disagrees (for example Hegang's Xing'an district).
        return r.code && codeOf(f) === r.code && containedByParent(f) && isExplicitSubarea(f);
      }
      // Missing legacy geometry needs a matching parent polygon as spatial evidence.
      return containedByParent(f);
    });
    if (possible.length !== 1) {
      unmatched.push({
        regionId: r.id,
        code: r.code,
        name: r.name,
        historical: r.historical,
        candidates: possible.map((f) => f.id),
        nameCandidates: features
          .filter((f) => [...names(f.properties)].some((n) => candidateNames.has(n)))
          .map((f) => ({
            relation: f.id,
            name: f.properties['name:zh'] || f.properties.name,
            code: codeOf(f),
            adminLevel: f.properties.admin_level,
            bounds: bounds(f.geometry),
          })),
        legacyBounds: previous.map((g) => bounds(g.geometry)),
      });
      continue;
    }
    const match = possible[0];
    replacements.set(r.id, match);
    mapped.push({
      regionId: r.id,
      code: r.code,
      name: r.name,
      relation: match.id,
      adminLevel: match.properties.admin_level,
      method:
        r.id === province.id
          ? 'province-relation'
          : job.reviewedMappings?.some((m) => m.code === r.code)
            ? 'reviewed-relation+name+iso+level+overlap'
            : `${r.code && codeOf(match) === r.code ? 'code+name' : 'name'}+level+${
                previous.length
                  ? previous.some(
                      (old) => overlap(bounds(old.geometry), bounds(match.geometry)) > 0.5,
                    )
                    ? 'overlap'
                    : 'explicit-parent-subarea'
                  : 'parent-bounds'
              }`,
    });
  }
  Object.assign(report, { province: job.code, name: province.name, mapped, unmatched });
  if (job.apply) {
    const preserved = ['810000', '820000'].includes(province.code)
      ? await read(path.join(root, 'data/boundaries/china-osm/retained-hkmo-counties.json'))
      : [];
    const preservedById = new Map(preserved.map((g) => [g.id, g]));
    const replacedRows = legacy.map((r) =>
      replacements.has(r.regionId) &&
      r.level !== 'border' &&
      // HK/MO county rows represent separate subareas tied to the aggregate
      // province ID. Never replace all of those with the entire province.
      !(
        r.regionId === province.id &&
        r.level === 'county' &&
        ['810000', '820000'].includes(province.code)
      )
        ? { ...r, geometry: replacements.get(r.regionId).geometry }
        : preservedById.get(r.id) || r,
    );
    const seen = new Set();
    const output = removeHistoricalGeometry(replacedRows, regions).filter((r) => {
      if (!replacements.has(r.regionId) || r.level === 'border' || preservedById.has(r.id))
        return true;
      const key = r.regionId + '/' + r.level;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    report.removedDuplicateRows = replacedRows.length - output.length;
    for (const [id, f] of replacements) {
      if (output.some((r) => r.regionId === id && r.level !== 'border')) continue;
      const region = regionMap.get(id);
      output.push({
        id: 'osm-' + id,
        regionId: id,
        level: ['province', 'city', 'county'][region.level],
        geometry: f.geometry,
      });
    }
    const reviewedOutput = await retainReviewedChinaGeometry(output, regions);
    report.geometrySha256 = await write(geometryFile, reviewedOutput);
    await recordReviewedChinaReimport(report.geometrySha256);
    report.applied = true;
  }
} else if (job.kind === 'national' && job.apply) {
  const national = features.find((f) => f.id === 'relation/270056');
  if (!national) throw Error('Missing national polygon');
  const output = removeHistoricalGeometry(legacy, regions).filter((r) => r.level !== 'border');
  output.push({
    id: 'osm-national-270056',
    regionId: null,
    level: 'border',
    geometry: {
      type: 'MultiLineString',
      coordinates: (national.geometry.type === 'Polygon'
        ? [national.geometry.coordinates]
        : national.geometry.coordinates
      ).flat(),
    },
  });
  const reviewedOutput = await retainReviewedChinaGeometry(output, regions);
  report.geometrySha256 = await write(geometryFile, reviewedOutput);
  await recordReviewedChinaReimport(report.geometrySha256);
  report.applied = true;
} else if (job.kind === 'reference') {
  report.purpose =
    'OSM reference geometry for later boundary review; not applied to the map catalog.';
  report.relations = features.map((f) => ({
    id: f.id,
    url: 'https://www.openstreetmap.org/' + f.id,
    name: f.properties['name:zh'] || f.properties.name,
    boundary: f.properties.boundary,
    controlled_by: f.properties.controlled_by,
    claimed_by: f.properties.claimed_by,
    bounds: bounds(f.geometry),
    vertices: f.geometry.coordinates.flat(Infinity).length / 2,
  }));
}
await write(job.output + '.report.json', report);
if (report.applied) {
  const filename = path.join(root, 'data/boundaries/china-osm/applied.json');
  const prior = await read(filename).catch(() => ({ provinces: {} }));
  const key = job.kind === 'national' ? 'national' : job.code;
  if (job.kind === 'national') prior.national = report;
  else prior.provinces[key] = report;
  prior.geometrySha256 = report.geometrySha256;
  await write(filename, prior);
}
console.log(
  JSON.stringify({
    kind: job.kind,
    code: job.code,
    downloaded: features.length,
    matched: report.mapped?.length,
    unmatched: report.unmatched?.length,
    applied: report.applied,
  }),
);
