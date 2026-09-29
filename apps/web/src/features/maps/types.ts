import type { Scope } from '@fangyu/contracts';
import type { Bounds } from '../../app/workspace.js';
export interface MapDataManifest {
  version: string;
  scopes: Record<
    Scope,
    {
      bounds: Bounds;
      regionBounds: Record<string, Bounds>;
      simplified: string;
      layers: { level: string; maxzoom: number; bounds: Bounds; url: string }[];
    }
  >;
}
export interface BasemapProvider {
  id: string;
  name: string;
  attribution: string;
  tiles: string[];
  labels: string[];
}
export function tianditu(key: string): BasemapProvider | null {
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(key)) return null;
  const url = (layer: string) =>
    'https://t0.tianditu.gov.cn/DataServer?T=' +
    layer +
    '_w&x={x}&y={y}&l={z}&tk=' +
    encodeURIComponent(key);
  return {
    id: 'tianditu',
    name: '天地图',
    attribution: '<a href="https://www.tianditu.gov.cn/" target="_blank">天地图</a>',
    tiles: [url('vec')],
    labels: [url('cva')],
  };
}

// Resolve only the prefix: URL() escapes the {z}/{x}/{y} placeholders MapLibre needs.
export function mapAssetUrl(base: string, resource: string, origin: string) {
  return new URL(base, origin).href + resource;
}
