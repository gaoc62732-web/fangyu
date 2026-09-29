import type { StyleSpecification } from 'maplibre-gl';
import type { Scope } from '@fangyu/contracts';
import { mapAssetUrl, type MapDataManifest, type BasemapProvider } from './types.js';
export function createMapStyle(
  manifest: MapDataManifest,
  scope: Scope,
  focused: string,
  provider: BasemapProvider | null,
  base: string,
  origin: string,
): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const layers: StyleSpecification['layers'] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#eaf0ed' } },
  ];
  if (provider) {
    sources.basemap = {
      type: 'raster',
      tiles: provider.tiles,
      tileSize: 256,
      attribution: provider.attribution,
    };
    sources.labels = { type: 'raster', tiles: provider.labels, tileSize: 256 };
    layers.push(
      { id: 'basemap', source: 'basemap', type: 'raster' },
      { id: 'labels', source: 'labels', type: 'raster' },
    );
  }
  for (const layer of manifest.scopes[scope].layers) {
    sources[layer.level] = {
      type: 'vector',
      tiles: [mapAssetUrl(base, layer.url, origin)],
      minzoom: 0,
      maxzoom: layer.maxzoom,
      bounds: layer.bounds,
      promoteId: 'regionId',
      attribution: '边界仅供旅行记录参考',
    };
    if (layer.level !== 'border')
      layers.push({
        id: layer.level + '-fill',
        type: 'fill',
        source: layer.level,
        'source-layer': 'regions',
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'fill'], '#edf1e9'],
          'fill-opacity': 0.3,
        },
      });
    layers.push({
      id: layer.level + '-line',
      type: 'line',
      source: layer.level,
      'source-layer': 'regions',
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          '#bb8137',
          '#829c91',
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          2,
          ['boolean', ['feature-state', 'hover'], false],
          1.5,
          0.65,
        ],
      },
    });
  }
  sources.points = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 44,
  };
  layers.push({
    id: 'clusters',
    type: 'circle',
    source: 'points',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#376c5c',
      'circle-radius': ['step', ['get', 'point_count'], 17, 100, 22, 1000, 27],
      'circle-stroke-color': '#fffdf7',
      'circle-stroke-width': 2,
    },
  });
  layers.push({
    id: 'cluster-count',
    type: 'symbol',
    source: 'points',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['sans-serif'],
      'text-size': 12,
    },
    paint: { 'text-color': '#fff' },
  });
  layers.push({
    id: 'selected-point',
    type: 'circle',
    source: 'points',
    filter: ['==', ['get', 'id'], focused],
    paint: {
      'circle-radius': 20,
      'circle-color': 'transparent',
      'circle-stroke-color': '#be873d',
      'circle-stroke-width': 3,
    },
  });
  layers.push({
    id: 'points',
    type: 'symbol',
    source: 'points',
    filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.62, 'icon-allow-overlap': false },
  });
  layers.push({
    id: 'point-labels',
    type: 'symbol',
    source: 'points',
    minzoom: 9,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['sans-serif'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.5],
      'text-max-width': 12,
    },
    paint: { 'text-color': '#29453a', 'text-halo-color': '#fffdf7', 'text-halo-width': 1.5 },
  });
  return { version: 8, sources, layers };
}
