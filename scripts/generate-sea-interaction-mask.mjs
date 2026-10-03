import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'data/extensions/research/south-china-sea-interaction-mask.json';
const outputPath = 'apps/web/src/features/maps/sea-interaction-mask.json';
const bytes = readFileSync(sourcePath);
const source = JSON.parse(bytes);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(source.polygons.length, 328, 'Reviewed component count changed; re-audit required');
for (const snapshot of source.sourceSnapshots) {
  assert.equal(
    sha256(readFileSync(snapshot.path.replaceAll('\\', '/'))),
    snapshot.sha256,
    `${snapshot.scope} source changed`,
  );
}
const runtime = {
  sourcePath,
  sourceMaskSha256: sha256(bytes),
  attribution: source.geometrySource.publisher,
  sourceUrl: source.geometrySource.url,
  license: source.geometrySource.license,
  licenseUrl: source.geometrySource.licenseUrl,
  processing: source.geometrySource.processing,
  sourceSnapshots: source.sourceSnapshots.map(({ scope, path, sha256 }) => ({
    scope,
    path: path.replaceAll('\\', '/'),
    sha256,
  })),
  scopes: source.appliesToScopes,
  polygons: source.polygons.map((item) => item.geometry.coordinates),
  retainedBoundsByScope: Object.fromEntries(
    source.appliesToScopes.map((scope) => [
      scope,
      source.retainedComponents.filter((item) => item.scope === scope).map((item) => item.bbox),
    ]),
  ),
};
writeFileSync(outputPath, JSON.stringify(runtime) + '\n');
console.log(
  `Generated ${source.polygons.length} exact interaction polygons; source ${runtime.sourceMaskSha256}.`,
);
