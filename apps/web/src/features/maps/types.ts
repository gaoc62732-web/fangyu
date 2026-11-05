import type { EntryView } from '@fangyu/domain';
import type { Scope, MapLevel } from '@fangyu/contracts';
import type { StyleSpecification } from 'maplibre-gl';
export type Bounds = [number, number, number, number];
export interface MapDataManifest {
  version: string;
  scopes: Record<
    Scope,
    {
      bounds: Bounds;
      regionBounds: Record<string, Bounds>;
      simplified: string;
      simplifiedLevels?: Record<string, string>;
      boundaryOptions?: string;
      boundaryOptionGroups?: number;
      layers: { level: string; maxzoom: number; bounds: Bounds; url: string; archive?: boolean }[];
    }
  >;
}
export interface BasemapProvider {
  kind: 'vector' | 'satellite';
  id: string;
  name: string;
  attribution: string;
  tiles: string[];
  labels: string[];
  style?: StyleSpecification;
}
export type BasemapKind = 'vector' | 'tianditu' | 'satellite';
export function tianditu(key: string, kind: 'vector' | 'satellite' = 'vector'): BasemapProvider | null {
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(key)) return null;
  const url = (layer: string) =>
    'https://t0.tianditu.gov.cn/DataServer?T=' +
    layer +
    '_w&x={x}&y={y}&l={z}&tk=' +
    encodeURIComponent(key);
  return {
    id: 'tianditu',
    kind,
    name: kind === 'satellite' ? '天地图卫星图' : '天地图政区图',
    attribution: '<a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a>',
    tiles: [url(kind === 'satellite' ? 'img' : 'vec')],
    labels: [url(kind === 'satellite' ? 'cia' : 'cva')],
  };
}

// Resolve only the prefix: URL() escapes the {z}/{x}/{y} placeholders MapLibre needs.
export function mapAssetUrl(base: string, resource: string, origin: string) {
  return new URL(base, origin).href + resource;
}

export interface TiledMapProps {
  scope: Scope;
  selected: string;
  selectionMuted?: boolean;
  level: MapLevel;
  category: string;
  points?: EntryView[] | undefined;
  highlightedPointIds?: string[] | undefined;
  focus?: [number, number] | null | undefined;
  focusPoints?: [number, number][] | null | undefined;
  pointMode?: boolean;
  regionMode?: boolean;
  initialCamera?: { center: [number, number]; zoom: number } | undefined;
  previewRegions?: string[] | undefined;
}
