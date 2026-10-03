import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  createPolygonHitPolicy,
  pointInPolygon,
  type PolygonCoordinates,
} from '../apps/web/src/features/maps/polygon-hit-policy.js';
import { CanvasMapRenderer } from '../packages/map-renderer/src/canvas-renderer.js';
import { regionInteractionPolicy } from '../apps/web/src/features/maps/sea-region-interaction.js';
import { SCOPE_IDS, type Scope } from '../packages/contracts/src/scopes.js';

const rectangle = (x: number, y: number, width = 1, height = 1): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
      [x, y],
    ],
  ],
});
const mask = rectangle(112, 16).coordinates;
const hole: PolygonCoordinates = [mask[0]!, rectangle(112.3, 16.3, 0.4, 0.4).coordinates[0]!];
assert(pointInPolygon([112.1, 16.1], hole));
assert(!pointInPolygon([112.5, 16.5], hole), 'A hole is not excluded');
assert(pointInPolygon([112.3, 16.5], hole), 'Hole boundary remains excluded');
assert(pointInPolygon([112, 16], mask), 'Exact source vertices are excluded');
assert(pointInPolygon([112.5, 16], mask), 'Exact source edges are excluded');
assert(
  pointInPolygon(
    [112.5, 16.5],
    mask.map((ring) => [...ring].reverse()),
  ),
  'Ring winding has no effect',
);

const policy = createPolygonHitPolicy([mask], [[108, 10, 110, 18]]);
assert.equal(policy([112.5, 16.5]), false);
assert.equal(policy([109, 16]), true, 'Nearby mainland is unaffected');
assert.equal(policy([113.05, 16.5]), true, 'No arbitrary buffer is added to the mask');
assert.equal(
  policy([113.05, 16.5], rectangle(111.95, 15.95, 1.1, 1.1)),
  false,
  'A quantized displayed edge belonging to the same isolated island is blocked',
);
const mixed: GeoJSON.MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    rectangle(108, 10, 2, 8).coordinates,
    rectangle(111.95, 15.95, 1.1, 1.1).coordinates,
  ],
};
assert.equal(
  policy([109, 16], mixed),
  true,
  'Do not disable mainland in the same region MultiPolygon',
);
assert.equal(policy([113.05, 16.5], mixed), false, 'Only the hit island fragment is classified');
assert.equal(
  policy([110.5, 16.5], rectangle(108, 10, 6, 8)),
  true,
  'An ambiguous large fragment touching retained land must not widen the exclusion',
);
assert.equal(
  policy([112.5, 16.5], rectangle(108, 10, 6, 8)),
  false,
  'An exact source-mask hit remains blocked even when rendered geometry is ambiguous',
);
assert.equal(
  policy([114, 16.5], rectangle(113.5, 16)),
  true,
  'A nearby disjoint polygon must remain interactive',
);

// Exercise the real shared Canvas hit method without a DOM/canvas constructor.
// Pointer hover and pointerup (including touch) both call this method.
const canvas = Object.create(CanvasMapRenderer.prototype) as any;
canvas.project = (point: [number, number]) => point;
canvas.unproject = (point: [number, number]) => point;
canvas.scale = 1;
canvas.x = 0;
canvas.y = 0;
canvas.context = { save() {}, restore() {}, setTransform() {}, isPointInPath: () => true };
canvas.scene = { features: [], points: [], allowsRegionHit: policy };
canvas.shapes = [
  { id: 'synthetic-region', name: 'Region', bounds: [108, 10, 114, 18], path: {}, geometry: mixed },
];
assert.equal(
  canvas.hit(112.5, 16.5),
  undefined,
  'Canvas blocked region cannot emit a hover/click selection',
);
assert.equal(
  canvas.hit(113.05, 16.5),
  undefined,
  'Canvas generalized fragment shares the same rule',
);
assert.equal(canvas.hit(109, 16).id, 'synthetic-region');
canvas.scene.points = [
  { id: 'synthetic-heritage', name: 'Retained point', coords: [112.5, 16.5], marked: true },
];
assert.deepEqual(
  canvas.hit(112.5, 16.5),
  { id: 'synthetic-heritage', name: 'Retained point', point: true },
  'Heritage/personal points remain selectable before the administrative rule',
);
canvas.scene.points = [];
canvas.scene.allowsRegionHit = undefined;
assert.equal(
  canvas.hit(112.5, 16.5).id,
  'synthetic-region',
  'Untargeted scopes retain original behavior',
);

console.log(
  'PASS polygon holes/edges/winding; isolated quantization fragments; retained mainland; shared Canvas hover/touch hit path; points unaffected.',
);

const runtime = JSON.parse(
  readFileSync('apps/web/src/features/maps/sea-interaction-mask.json', 'utf8'),
);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = readFileSync(runtime.sourcePath);
assert.equal(
  digest(sourceBytes),
  runtime.sourceMaskSha256,
  'Runtime mask must match the frozen research evidence',
);
const source = JSON.parse(sourceBytes.toString('utf8'));
assert.deepEqual(
  runtime.polygons,
  source.polygons.map((item: any) => item.geometry.coordinates),
);
assert.deepEqual(runtime.scopes, source.appliesToScopes);
for (const snapshot of runtime.sourceSnapshots) {
  assert.equal(
    digest(readFileSync(snapshot.path.replaceAll('\\', '/'))),
    snapshot.sha256,
    `${snapshot.scope} raw source bytes unchanged`,
  );
  assert.deepEqual(
    runtime.retainedBoundsByScope[snapshot.scope],
    source.retainedComponents
      .filter((item: any) => item.scope === snapshot.scope)
      .map((item: any) => item.bbox),
  );
}
const cases = JSON.parse(
  readFileSync('data/extensions/research/south-china-sea-interaction-testpoints.json', 'utf8'),
);
let geographicChecks = 0;
for (const test of cases.tests) {
  for (const scope of runtime.scopes as Scope[]) {
    assert.equal(
      regionInteractionPolicy(scope)!(test.coordinate),
      !test.expectedBlockedInScopes.includes(scope),
      `${test.id} in ${scope}`,
    );
    geographicChecks++;
  }
}
for (const scope of SCOPE_IDS.filter((scope) => !runtime.scopes.includes(scope))) {
  assert.equal(
    regionInteractionPolicy(scope),
    undefined,
    `${scope} including France/China levels must retain original interactions`,
  );
}
const named = JSON.parse(
  readFileSync('data/extensions/research/south-china-sea-named-island-tests.json', 'utf8'),
);
for (const test of named.tests) {
  for (const scope of runtime.scopes as Scope[]) {
    const actualAdministrativeHit =
      test.rawHitsByScope[scope].length > 0 && regionInteractionPolicy(scope)!(test.coordinate);
    assert.equal(
      actualAdministrativeHit,
      test.expectedAdministrativeHitAfterFilter[scope],
      `${test.nameZh}/${scope}`,
    );
  }
}
const results = {
  status: 'pass',
  sourceMaskSha256: runtime.sourceMaskSha256,
  rawGeometryHashesUnchanged: runtime.sourceSnapshots,
  exactPolygons: runtime.polygons.length,
  geographicChecks,
  namedIslandCases: named.tests.length,
  untouchedScopes: SCOPE_IDS.filter((scope) => !runtime.scopes.includes(scope)),
  pureChecks: [
    'holes',
    'edges',
    'winding',
    'quantized fragment',
    'mixed mainland/island MultiPolygon',
    'ambiguous mainland fragment retained',
    'Canvas shared hit path',
    'point priority',
  ],
  limitations:
    'DOM pointer dispatch and MapLibre query behavior require separate browser checks; this test exercises the real shared Canvas hit method without constructing a browser canvas.',
};
mkdirSync('data/generated/sea-region-interaction', { recursive: true });
writeFileSync(
  'data/generated/sea-region-interaction/pure-results.json',
  JSON.stringify(results, null, 2) + '\n',
);
console.log(
  `PASS ${geographicChecks} source-component/scope checks; ${named.tests.length} named-island cases; all other scopes untouched; source hashes unchanged.`,
);
