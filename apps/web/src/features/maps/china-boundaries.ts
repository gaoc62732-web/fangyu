import type { ChinaBoundarySettings } from '@fangyu/contracts';
import type { Bounds } from './types.js';

export interface ChinaBoundaryFeatureDiff {
  remove: string[];
  add: GeoJSON.Feature[];
  update: {
    id: string;
    newGeometry: GeoJSON.Geometry;
    removeAllProperties: true;
    addOrUpdateProperties: { key: string; value: unknown }[];
  }[];
}

export interface ChinaBoundaryData {
  geometries: Record<string, GeoJSON.Geometry>;
  groups: {
    keys: (keyof ChinaBoundarySettings)[];
    regionIds: string[];
    variants: Record<
      string,
      { regionId: string; level: string; name: string; geometry: string; bounds: Bounds }[]
    >;
  }[];
  lineGroups?: {
    keys: (keyof ChinaBoundarySettings)[];
    variants: Record<
      string,
      {
        regionId: string;
        level: string;
        name: string;
        geometry: string;
        boundaryKind: string;
        displayAt?: 'county' | 'province-city';
      }[]
    >;
  }[];
}

export function chinaBoundaryLines(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
  level?: string,
): GeoJSON.FeatureCollection {
  const displayAt =
    level === undefined
      ? undefined
      : level === 'county'
        ? 'county'
        : ['province', 'city'].includes(level)
          ? 'province-city'
          : 'hidden';
  return {
    type: 'FeatureCollection',
    features: (data.lineGroups || []).flatMap((group) => {
      const key = group.keys.map((item) => (settings[item] ? '1' : '0')).join('');
      return (group.variants[key] || [])
        .filter((feature) => !displayAt || !feature.displayAt || feature.displayAt === displayAt)
        .map(({ geometry, ...properties }) => ({
          type: 'Feature' as const,
          id: `${properties.boundaryKind}-${properties.regionId}-${properties.displayAt || 'all'}`,
          properties,
          geometry: data.geometries[geometry]!,
        }));
    }),
  };
}

export function chinaBoundaryFeatures(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.groups.flatMap((_, index) =>
      chinaBoundaryFeatureGroup(data, settings, index).features,
    ),
  };
}

export function chinaBoundaryFeatureGroup(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
  index: number,
): GeoJSON.FeatureCollection {
  const group = data.groups[index];
  if (!group) throw new RangeError(`Unknown China boundary group: ${index}`);
  const key = group.keys.map((item) => (settings[item] ? '1' : '0')).join('');
  return {
    type: 'FeatureCollection',
    features: group.variants[key]!.map(({ geometry, bounds: _bounds, ...properties }) => ({
      type: 'Feature' as const,
      id: properties.regionId,
      properties,
      geometry: data.geometries[geometry]!,
    })),
  };
}

export function chinaBoundarySourceId(index: number) {
  return `china-options-${index}`;
}

export function chinaBoundaryLayerId(index: number, layer: string) {
  return `china-options-${layer}-${index}`;
}

/**
 * Build the small diff needed by MapLibre's updateData API when a boundary
 * option changes. The source uses regionId as promoteId, so every feature ID
 * is stable even when its geometry is replaced by a different local variant.
 */
export function chinaBoundaryFeatureDiff(
  previous: GeoJSON.FeatureCollection,
  next: GeoJSON.FeatureCollection,
): ChinaBoundaryFeatureDiff {
  const before = new Map(previous.features.map((feature) => [String(feature.id), feature]));
  const after = new Map(next.features.map((feature) => [String(feature.id), feature]));
  const remove: string[] = [];
  const add: GeoJSON.Feature[] = [];
  const update: ChinaBoundaryFeatureDiff['update'] = [];
  for (const id of before.keys()) if (!after.has(id)) remove.push(id);
  for (const [id, feature] of after) {
    if (!before.has(id)) add.push(feature);
    else {
      const previous = before.get(id)!;
      const previousProperties = previous.properties || {};
      const properties = feature.properties || {};
      const sameProperties =
        Object.keys(previousProperties).length === Object.keys(properties).length &&
        Object.entries(properties).every(([key, value]) => previousProperties[key] === value);
      // Variants reuse the geometry objects from the shared geometry bank.
      // Avoid sending unchanged features back through the worker.
      if (previous.geometry === feature.geometry && sameProperties) continue;
      update.push({
        id,
        newGeometry: feature.geometry,
        removeAllProperties: true,
        addOrUpdateProperties: Object.entries(properties).map(([key, value]) => ({ key, value })),
      });
    }
  }
  return { remove, add, update };
}

export function chinaBoundaryBounds(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
  id: string,
): Bounds | undefined {
  for (const group of data.groups) {
    const key = group.keys.map((key) => (settings[key] ? '1' : '0')).join('');
    const row = group.variants[key]!.find((row) => row.regionId === id);
    if (row) return row.bounds;
  }
  return undefined;
}

export function applyChinaBoundaries(
  collection: GeoJSON.FeatureCollection,
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
  level?: string,
): GeoJSON.FeatureCollection {
  const replaced = new Set(data.groups.flatMap((group) => group.regionIds));
  return {
    type: 'FeatureCollection',
    features: [
      ...collection.features.filter((f) => !replaced.has(String(f.properties?.regionId || f.id))),
      ...chinaBoundaryFeatures(data, settings).features,
      ...chinaBoundaryLines(data, settings, level).features,
    ],
  };
}
