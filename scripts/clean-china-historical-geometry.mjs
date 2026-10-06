import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { removeHistoricalGeometry } from './lib/china-boundary-policy.mjs';

const root = new URL('../', import.meta.url);
const geometryFile = new URL('data/catalog/china.geo.json', root);
const catalog = JSON.parse(await fs.readFile(new URL('data/catalog/catalog.json', root), 'utf8'));
const beforeBytes = await fs.readFile(geometryFile);
const before = JSON.parse(beforeBytes);
const after = removeHistoricalGeometry(before, catalog.regions);
const kept = new Set(after.map((row) => row.id));
const regionMap = new Map(catalog.regions.map((region) => [region.id, region]));
const report = {
  policy:
    'Delete historical geometry from the active dataset; retain region identities and records.',
  removed: before
    .filter((row) => !kept.has(row.id))
    .map((row) => ({
      geometryId: row.id,
      regionId: row.regionId,
      name: regionMap.get(row.regionId)?.name,
    })),
  beforeSha256: createHash('sha256').update(beforeBytes).digest('hex'),
  applied: process.argv.includes('--apply'),
};
if (report.applied && report.removed.length) {
  const afterBytes = JSON.stringify(after) + '\n';
  await fs.writeFile(geometryFile, afterBytes);
  report.afterSha256 = createHash('sha256').update(afterBytes).digest('hex');
  report.updatedAt = new Date().toISOString();
  await fs.mkdir(new URL('data/boundaries/china-policy/', root), { recursive: true });
  await fs.writeFile(
    new URL('data/boundaries/china-policy/historical-removal.json', root),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(JSON.stringify(report, null, 2));
