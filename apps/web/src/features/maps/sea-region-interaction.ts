import type { Scope } from '@fangyu/contracts';
import mask from './sea-interaction-mask.json';
import { createPolygonHitPolicy, type PolygonBounds } from './polygon-hit-policy.js';

// This is a user-requested interaction policy, not a new boundary or sovereignty label.
// Its exact components and source hashes are recorded in mask.sourcePath.
const policies = new Map(
  mask.scopes.map((scope) => [
    scope,
    createPolygonHitPolicy(
      mask.polygons,
      mask.retainedBoundsByScope[scope as keyof typeof mask.retainedBoundsByScope].map(
        (bounds): PolygonBounds => [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!],
      ),
    ),
  ]),
);

export function regionInteractionPolicy(scope: Scope) {
  return policies.get(scope);
}
