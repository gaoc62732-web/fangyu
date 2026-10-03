type Point = readonly number[];
export type PolygonCoordinates = readonly (readonly Point[])[];
export type PolygonBounds = readonly [number, number, number, number];

export function polygonBounds(polygon: PolygonCoordinates): PolygonBounds {
  const points = polygon[0] || [];
  return points.reduce<[number, number, number, number]>(
    (b, p) => [
      Math.min(b[0], p[0]!),
      Math.min(b[1], p[1]!),
      Math.max(b[2], p[0]!),
      Math.max(b[3], p[1]!),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}
const overlaps = (a: PolygonBounds, b: PolygonBounds) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const contains = (b: PolygonBounds, p: Point) =>
  p[0]! >= b[0] && p[0]! <= b[2] && p[1]! >= b[1] && p[1]! <= b[3];
const cross = (a: Point, b: Point, p: Point) =>
  (b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!);
function onSegment(a: Point, b: Point, p: Point) {
  return (
    Math.abs(cross(a, b, p)) <= 1e-12 &&
    p[0]! >= Math.min(a[0]!, b[0]!) - 1e-12 &&
    p[0]! <= Math.max(a[0]!, b[0]!) + 1e-12 &&
    p[1]! >= Math.min(a[1]!, b[1]!) - 1e-12 &&
    p[1]! <= Math.max(a[1]!, b[1]!) + 1e-12
  );
}
// 0 outside, 1 inside, 2 on an edge. Ring direction is deliberately irrelevant.
function ringLocation(point: Point, ring: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!,
      b = ring[i]!;
    if (onSegment(a, b, point)) return 2;
    if (
      a[1]! > point[1]! !== b[1]! > point[1]! &&
      point[0]! < ((b[0]! - a[0]!) * (point[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    )
      inside = !inside;
  }
  return inside ? 1 : 0;
}
export function pointInPolygon(point: Point, polygon: PolygonCoordinates) {
  if (!polygon[0]) return false;
  const outer = ringLocation(point, polygon[0]);
  if (!outer) return false;
  if (outer === 2) return true;
  for (const hole of polygon.slice(1)) {
    const location = ringLocation(point, hole);
    if (location === 2) return true;
    if (location === 1) return false;
  }
  return true;
}
function polygonsIntersect(a: PolygonCoordinates, b: PolygonCoordinates) {
  if (
    (a[0] || []).some((p) => pointInPolygon(p, b)) ||
    (b[0] || []).some((p) => pointInPolygon(p, a))
  )
    return true;
  for (const ar of a)
    for (const br of b) {
      for (let i = 0, j = ar.length - 1; i < ar.length; j = i++) {
        for (let k = 0, l = br.length - 1; k < br.length; l = k++) {
          const p = ar[j]!,
            q = ar[i]!,
            r = br[l]!,
            s = br[k]!;
          if (onSegment(p, q, r) || onSegment(p, q, s) || onSegment(r, s, p) || onSegment(r, s, q))
            return true;
          if (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0)
            return true;
        }
      }
    }
  return false;
}

/** Compile once. Bounds only prune tests; exact rings decide the exclusion. */
export function createPolygonHitPolicy(
  excluded: readonly PolygonCoordinates[],
  retainedBounds: readonly PolygonBounds[],
) {
  const masks = excluded.map((polygon) => ({ polygon, bounds: polygonBounds(polygon) }));
  return (point: Point, renderedGeometry?: GeoJSON.Geometry) => {
    if (masks.some((mask) => contains(mask.bounds, point) && pointInPolygon(point, mask.polygon)))
      return false;
    if (!renderedGeometry) return true;
    const polygons =
      renderedGeometry.type === 'Polygon'
        ? [renderedGeometry.coordinates]
        : renderedGeometry.type === 'MultiPolygon'
          ? renderedGeometry.coordinates
          : [];
    // MVT quantization can extend an island's displayed edge beyond the raw ring.
    // Examine only the polygon containing the hit, never the whole region's MultiPolygon.
    for (const polygon of polygons) {
      const bounds = polygonBounds(polygon);
      if (!contains(bounds, point) || !pointInPolygon(point, polygon)) continue;
      // A fragment overlapping retained land's bounds is ambiguous: do not expand
      // the exclusion onto it. Exact source-mask hits above remain excluded.
      if (retainedBounds.some((retained) => overlaps(bounds, retained))) continue;
      if (
        masks.some(
          (mask) => overlaps(bounds, mask.bounds) && polygonsIntersect(polygon, mask.polygon),
        )
      )
        return false;
    }
    return true;
  };
}
