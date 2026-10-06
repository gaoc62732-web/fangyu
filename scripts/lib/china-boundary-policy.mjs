import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Historical region identities remain available for records, but their geometry
// must never enter the current administrative boundary dataset.
export function removeHistoricalGeometry(rows, regions) {
  const historicalIds = new Set(
    regions.filter((region) => region.scope === 'china' && region.historical).map((r) => r.id),
  );
  return rows.filter((row) => !historicalIds.has(row.regionId));
}

// Once the reviewed dataset is published, a new OSM import must keep the exact
// reviewed coast and administrative edits. Raw OSM remains in china-osm for review.
export async function retainReviewedChinaGeometry(rows, regions) {
  const base = fileURLToPath(new URL('../../data/boundaries/china-policy/', import.meta.url));
  const applied = await fs.readFile(base + 'applied.json', 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!applied) return removeHistoricalGeometry(rows, regions);
  const reviewed = JSON.parse(await fs.readFile(base + 'published-overrides.json', 'utf8'));
  const protectedRegionIds = new Set(reviewed.map((r) => r.regionId).filter(Boolean));
  return removeHistoricalGeometry(
    [
      ...rows.filter((r) => r.level !== 'border' && !protectedRegionIds.has(r.regionId)),
      ...reviewed,
    ],
    regions,
  );
}

export async function recordReviewedChinaReimport(geometrySha256) {
  const filename = fileURLToPath(
    new URL('../../data/boundaries/china-policy/applied.json', import.meta.url),
  );
  const bytes = await fs.readFile(filename, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!bytes) return;
  const report = JSON.parse(bytes);
  report.geometrySha256 = geometrySha256;
  report.osmReimportedAt = new Date().toISOString();
  await fs.writeFile(filename, JSON.stringify(report) + '\n');
}
