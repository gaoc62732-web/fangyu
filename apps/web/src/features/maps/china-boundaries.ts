import type { ChinaBoundarySettings } from '@fangyu/contracts';
import type { Bounds } from './types.js';

interface ArcRef {
  arcId: string;
  direction: 1 | -1;
}

interface PolygonPathSet {
  type: 'PolygonPathSet';
  geometryType?: 'Polygon' | 'MultiPolygon';
  polygons: {
    rings: (({ role: 'outer' | 'inner' } & ArcRef) | { role: 'outer' | 'inner'; arcs: ArcRef[] })[];
  }[];
}

interface BoundaryFeature {
  regionId: string;
  level: string;
  name: string;
  geometry?: string;
  pathId?: string;
  geometryPath?: PolygonPathSet | null;
  bounds?: Bounds;
}

export interface ChinaBoundaryData {
  schemaVersion: 2;
  arcs: Record<string, GeoJSON.LineString>;
  paths?: Record<string, PolygonPathSet>;
  profiles: {
    keys: (keyof ChinaBoundarySettings)[];
    regionIds: string[];
    variants: Record<string, BoundaryFeature[]>;
  }[];
  fixedPaths: {
    id: string;
    name: string;
    arcIds?: string[];
    boundaryKind: string;
    displayAt?: string[];
    settingKeys: (keyof ChinaBoundarySettings)[];
  }[];
}

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

export async function loadChinaBoundaryData(baseUrl: string): Promise<ChinaBoundaryData> {
  const response = await fetch(baseUrl + 'maps/china-boundary-options.json.gz', {
    cache: 'no-cache',
  });
  if (!response.ok) throw Error('地区归属边界暂时无法加载。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const data =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).json()
      : JSON.parse(new TextDecoder().decode(bytes));
  if (
    data.schemaVersion !== 2 ||
    !data.arcs ||
    !Array.isArray(data.profiles) ||
    !Array.isArray(data.fixedPaths)
  )
    throw Error('边界资源格式不正确，请重新生成前端数据。');
  return data as ChinaBoundaryData;
}

export function chinaBoundaryGroups(data: ChinaBoundaryData) {
  return (
    data.profiles || (data as unknown as { groups?: ChinaBoundaryData['profiles'] }).groups || []
  );
}

export function chinaBoundaryReplacedRegionIds(
  data: ChinaBoundaryData,
  _settings: ChinaBoundarySettings,
): string[] {
  // Keep the base vector layers suppressed for every region owned by an
  // option group. The selected variant may omit a temporary region (for
  // example when it is merged into its neighbour), but letting that region
  // back into the ordinary source during a toggle causes the adjacent
  // overlay features to disappear while the source is being updated.
  // Older in-memory fixtures used by the simplified-map tests still expose
  // the pre-profile `groups` shape. Accept it while published data uses the
  // schema-v2 profiles above.
  const profiles =
    data.profiles ||
    (
      data as unknown as {
        groups?: { regionIds: string[] }[];
      }
    ).groups ||
    [];
  return profiles.flatMap((group) => group.regionIds);
}

const geometryCache = new WeakMap<
  ChinaBoundaryData,
  Map<string | PolygonPathSet, GeoJSON.Geometry>
>();
const samePosition = (a: GeoJSON.Position, b: GeoJSON.Position) => a[0] === b[0] && a[1] === b[1];

function arcCoordinates(data: ChinaBoundaryData, arcId: string): GeoJSON.Position[] {
  const arc = data.arcs[arcId];
  if (!arc) throw Error(`边界路径引用了不存在的弧：${arcId}`);
  return arc.coordinates;
}

function ringCoordinates(data: ChinaBoundaryData, refs: ArcRef[]): GeoJSON.Position[] {
  const result: GeoJSON.Position[] = [];
  for (const ref of refs) {
    const coordinates = arcCoordinates(data, ref.arcId);
    const points = ref.direction === -1 ? [...coordinates].reverse() : coordinates;
    if (result.length && !samePosition(result[result.length - 1]!, points[0]!))
      throw Error(`边界环未连接：${ref.arcId}`);
    for (let i = result.length ? 1 : 0; i < points.length; i++) result.push(points[i]!);
  }
  if (result.length < 4 || !samePosition(result[0]!, result[result.length - 1]!))
    throw Error('边界环尚未闭合。');
  return result;
}

function pathGeometry(data: ChinaBoundaryData, pathRef: string | PolygonPathSet): GeoJSON.Geometry {
  let cache = geometryCache.get(data);
  if (!cache) geometryCache.set(data, (cache = new Map()));
  const cached = cache.get(pathRef);
  if (cached) return cached;
  const path = typeof pathRef === 'string' ? data.paths?.[pathRef] : pathRef;
  if (!path) throw Error(`边界路径不存在：${pathRef}`);
  const polygons = path.polygons.map((polygon) =>
    polygon.rings.map((ring) => ringCoordinates(data, 'arcs' in ring ? ring.arcs : [ring])),
  );
  const geometry: GeoJSON.Geometry =
    path.geometryType === 'Polygon'
      ? { type: 'Polygon', coordinates: polygons[0]! }
      : { type: 'MultiPolygon', coordinates: polygons };
  cache.set(pathRef, geometry);
  return geometry;
}

function lineBoundaryKind(path: ChinaBoundaryData['fixedPaths'][number]) {
  return path.boundaryKind === 'nominal' ? 'tanggula-nominal' : path.boundaryKind;
}

export function chinaBoundaryLines(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
  level?: string,
): GeoJSON.FeatureCollection {
  const fixedPaths = data.fixedPaths || [];
  return {
    type: 'FeatureCollection',
    features: fixedPaths
      .filter(
        (path) =>
          path.arcIds?.length &&
          path.settingKeys.every((key) => settings[key]) &&
          (!level ||
            !path.displayAt?.length ||
            path.displayAt.includes(level) ||
            (path.displayAt.includes('province-city') &&
              (level === 'province' || level === 'city'))),
      )
      .map((path) => ({
        type: 'Feature' as const,
        id: path.id,
        properties: {
          regionId: path.id,
          name: path.name,
          level: 'border',
          boundaryKind: lineBoundaryKind(path),
        },
        // Each arc is an independent line; joining them would draw false connecting edges.
        geometry: {
          type: 'MultiLineString' as const,
          coordinates: path.arcIds!.map((id) => arcCoordinates(data, id)),
        },
      })),
  };
}

export function chinaBoundaryFeatureGroup(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
  index: number,
): GeoJSON.FeatureCollection {
  const legacy = data as unknown as {
    geometries?: Record<string, GeoJSON.Geometry>;
    groups?: {
      keys: (keyof ChinaBoundarySettings)[];
      variants: Record<string, (BoundaryFeature & { geometry?: string })[]>;
    }[];
  };
  const group = (data.profiles || legacy.groups || [])[index];
  if (!group) throw new RangeError(`Unknown China boundary group: ${index}`);
  const key = group.keys.map((item) => (settings[item] ? '1' : '0')).join('');
  const rows = group.variants[key];
  if (!rows) throw Error(`边界归属组合不存在：${index}/${key}`);
  return {
    type: 'FeatureCollection',
    features: rows.flatMap(({ pathId, geometryPath, bounds: _bounds, geometry, ...properties }) => {
      const path = geometryPath ?? pathId;
      const legacyGeometry =
        typeof geometry === 'string' ? legacy.geometries?.[geometry] : undefined;
      if (!path && !legacyGeometry) return [];
      return [
        {
          type: 'Feature' as const,
          id: properties.regionId,
          properties,
          geometry: legacyGeometry || pathGeometry(data, path!),
        },
      ];
    }),
  };
}

export function chinaBoundaryFeatures(
  data: ChinaBoundaryData,
  settings: ChinaBoundarySettings,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: chinaBoundaryGroups(data).flatMap(
      (_, index) => chinaBoundaryFeatureGroup(data, settings, index).features,
    ),
  };
}

export function chinaBoundarySourceId(index: number) {
  return `china-options-${index}`;
}
export function chinaBoundaryLayerId(index: number, layer: string) {
  return `china-options-${layer}-${index}`;
}

export function chinaBoundaryFeatureDiff(
  previous: GeoJSON.FeatureCollection,
  next: GeoJSON.FeatureCollection,
): ChinaBoundaryFeatureDiff {
  const before = new Map(previous.features.map((feature) => [String(feature.id), feature]));
  const after = new Map(next.features.map((feature) => [String(feature.id), feature]));
  const remove: string[] = [],
    add: GeoJSON.Feature[] = [],
    update: ChinaBoundaryFeatureDiff['update'] = [];
  for (const id of before.keys()) if (!after.has(id)) remove.push(id);
  for (const [id, feature] of after) {
    if (!before.has(id)) add.push(feature);
    else {
      const previous = before.get(id)!;
      const previousProperties = previous.properties || {},
        properties = feature.properties || {};
      const sameProperties =
        Object.keys(previousProperties).length === Object.keys(properties).length &&
        Object.entries(properties).every(([key, value]) => previousProperties[key] === value);
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
  for (const group of chinaBoundaryGroups(data)) {
    const key = group.keys.map((key) => (settings[key] ? '1' : '0')).join('');
    const row = group.variants[key]?.find((row) => row.regionId === id);
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
  const replaced = new Set(chinaBoundaryReplacedRegionIds(data, settings));
  const lines = chinaBoundaryLines(data, settings, level);
  const replacedLineKinds = new Set(
    (data.fixedPaths || []).filter((path) => path.arcIds?.length).map(lineBoundaryKind),
  );
  return {
    type: 'FeatureCollection',
    features: [
      ...collection.features.filter(
        (f) =>
          !replaced.has(String(f.properties?.regionId || f.id)) &&
          !replacedLineKinds.has(f.properties?.boundaryKind),
      ),
      ...chinaBoundaryFeatures(data, settings).features,
      ...lines.features,
    ],
  };
}
