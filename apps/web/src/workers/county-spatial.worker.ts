/// <reference lib="webworker" />
import { loadGeometry } from '@fangyu/catalog';
import type { GeometryFeature } from '@fangyu/contracts';
import { CountySpatialIndex, matchGeographicFiles } from '@fangyu/import-export';
import { applyChinaBoundaries, type ChinaBoundaryData } from '../features/maps/china-boundaries.js';
import type {
  CountySpatialRequest,
  CountySpatialResponse,
} from '../features/imports/county-spatial-protocol.js';

let spatial: CountySpatialIndex | undefined;

async function loadBoundaryData(baseUrl: string): Promise<ChinaBoundaryData> {
  const response = await fetch(baseUrl + 'maps/china-boundary-options.json.gz');
  if (!response.ok) throw Error('地区归属边界暂时无法加载。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).json() as Promise<ChinaBoundaryData>;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as ChinaBoundaryData;
}

async function initialize(payload: Extract<CountySpatialRequest, { type: 'init' }>['payload']) {
  const [geometry, boundaryData] = await Promise.all([
    loadGeometry(payload.baseUrl + 'geometry/', 'china'),
    loadBoundaryData(payload.baseUrl),
  ]);
  const collection = applyChinaBoundaries(
    {
      type: 'FeatureCollection',
      features: geometry.map((feature) => ({
        type: 'Feature' as const,
        id: feature.id,
        properties: { regionId: feature.regionId, level: feature.level },
        geometry: feature.geometry,
      })),
    },
    boundaryData,
    payload.settings,
  );
  const effectiveGeometry = collection.features.map((feature) => ({
    id: String(feature.id),
    regionId: String(feature.properties?.regionId),
    level: String(feature.properties?.level),
    geometry: feature.geometry,
  })) as GeometryFeature[];
  spatial = new CountySpatialIndex(payload.counties, effectiveGeometry);
}

self.onmessage = async (event: MessageEvent<CountySpatialRequest>) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'init') {
      await initialize(payload);
      self.postMessage({ id, result: null } satisfies CountySpatialResponse);
      return;
    }
    if (!spatial) throw Error('县级空间索引尚未初始化。');
    const result =
      type === 'geographic'
        ? matchGeographicFiles(spatial, payload)
        : payload.map((point) => [...spatial!.pointHits(point)]);
    self.postMessage({ id, result } satisfies CountySpatialResponse);
  } catch (cause) {
    self.postMessage({ id, error: String(cause) } satisfies CountySpatialResponse);
  }
};
