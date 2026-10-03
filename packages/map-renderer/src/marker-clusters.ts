export interface ScreenMarker<T> {
  id: string;
  x: number;
  y: number;
  value: T;
}
export interface ScreenMarkerCluster<T> {
  x: number;
  y: number;
  members: T[];
}

/** Fixed-radius screen buckets avoid quadratic scans and preserve every member.
 * Stable ID order prevents record insertion order from moving cluster anchors. */
export function clusterScreenMarkers<T>(
  points: readonly ScreenMarker<T>[],
  radius = 40,
): ScreenMarkerCluster<T>[] {
  if (!(radius > 0) || !Number.isFinite(radius)) throw Error('Invalid marker cluster radius');
  type Group = ScreenMarkerCluster<T> & {
    anchorX: number;
    anchorY: number;
    sumX: number;
    sumY: number;
  };
  const groups: Group[] = [];
  const buckets = new Map<string, Group[]>();
  const seen = new Set<string>();
  for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(point.id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    seen.add(point.id);
    const cellX = Math.floor(point.x / radius),
      cellY = Math.floor(point.y / radius);
    let nearest: Group | undefined,
      distance = radius;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const group of buckets.get(`${cellX + dx}/${cellY + dy}`) || []) {
          const d = Math.hypot(point.x - group.anchorX, point.y - group.anchorY);
          if (d <= distance) {
            nearest = group;
            distance = d;
          }
        }
      }
    if (nearest) {
      nearest.members.push(point.value);
      nearest.sumX += point.x;
      nearest.sumY += point.y;
      nearest.x = nearest.sumX / nearest.members.length;
      nearest.y = nearest.sumY / nearest.members.length;
    } else {
      const group: Group = {
        x: point.x,
        y: point.y,
        anchorX: point.x,
        anchorY: point.y,
        sumX: point.x,
        sumY: point.y,
        members: [point.value],
      };
      groups.push(group);
      const key = `${cellX}/${cellY}`;
      const bucket = buckets.get(key) || [];
      bucket.push(group);
      buckets.set(key, bucket);
    }
  }
  return groups.map(({ x, y, members }) => ({ x, y, members }));
}
