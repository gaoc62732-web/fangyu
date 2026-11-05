import { clusterScreenMarkers } from './marker-clusters.js';

export interface GeographicMarker<T> {
  id: string;
  coordinates: [number, number];
  value: T;
}

export interface GeographicMarkerCluster<T> {
  id: string;
  coordinates: [number, number];
  members: T[];
  expansionZoom: number;
}

interface ClusterNode<T> extends GeographicMarkerCluster<T> {
  x: number;
  y: number;
  firstId: string;
}

export function geographicClusters<T>(
  markers: readonly GeographicMarker<T>[],
  radius = 64,
  mergeRadius = 48,
  maxZoom = 20,
) {
  const step = 2;
  const top = maxZoom * step;
  const levels: ClusterNode<T>[][] = [];
  const seen = new Set<string>();
  let nodes: ClusterNode<T>[] = [];
  for (const marker of [...markers].sort((a, b) => a.id.localeCompare(b.id))) {
    const [longitude, latitude] = marker.coordinates;
    if (seen.has(marker.id) || !Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    seen.add(marker.id);
    const phi = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
    nodes.push({
      id: marker.id,
      firstId: marker.id,
      coordinates: marker.coordinates,
      x: (longitude + 180) / 360,
      y: (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2,
      members: [marker.value],
      expansionZoom: maxZoom,
    });
  }
  for (let level = top; level >= 0; level--) {
    const scale = 512 * Math.pow(2, level / step);
    const groups = clusterScreenMarkers(nodes.map((node) => ({
      id: node.id, x: node.x * scale, y: node.y * scale, value: node,
    })), radius, mergeRadius);
    nodes = groups.map((group) => {
      if (group.members.length === 1) return group.members[0]!;
      const size = group.members.reduce((sum, child) => sum + child.members.length, 0);
      const x = group.members.reduce((sum, child) => sum + child.x * child.members.length, 0) / size;
      const y = group.members.reduce((sum, child) => sum + child.y * child.members.length, 0) / size;
      const firstId = group.members.reduce((first, child) => child.firstId < first ? child.firstId : first, group.members[0]!.firstId);
      return {
        id: `cluster:${level}:${firstId}`,
        firstId, x, y,
        coordinates: [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI] as [number, number],
        members: group.members.flatMap((child) => child.members),
        expansionZoom: Math.min(maxZoom, (level + 1) / step),
      };
    });
    levels[level] = nodes;
  }
  return {
    atZoom(zoom: number): readonly GeographicMarkerCluster<T>[] {
      return levels[Math.max(0, Math.min(top, Math.floor(zoom * step + 1e-6)))] || [];
    },
  };
}
