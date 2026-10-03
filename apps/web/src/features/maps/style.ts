import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { Scope } from '@fangyu/contracts';
import { mapAssetUrl, type MapDataManifest, type BasemapProvider } from './types.js';
import { mapAttributions } from './data-attribution.js';

export const VISITED_MARKER_LAYER_IDS = ['visited-clusters', 'visited-markers'] as const;

export function boundaryFillOpacity(
  provider: BasemapProvider | null,
): number | ExpressionSpecification {
  if (!provider) return 1;
  return [
    'case',
    ['boolean', ['feature-state', 'recorded'], false],
    provider.kind === 'satellite' ? 0.65 : 0.82,
    provider.kind === 'satellite' ? 0.08 : 0.15,
  ];
}

// Keep the collaborator's MVT/feature-state architecture behind the existing map controls.
export function createMapStyle(
  manifest: MapDataManifest,
  scope: Scope,
  level: string,
  provider: BasemapProvider | null,
  base: string,
  origin: string,
): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const layers: StyleSpecification['layers'] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#eef4f3' } },
  ];
  if (provider) {
    sources.basemap = {
      type: 'raster',
      tiles: provider.tiles,
      tileSize: 256,
      attribution: provider.attribution,
    };
    layers.push({ id: 'basemap', source: 'basemap', type: 'raster' });
  }
  for (const layer of manifest.scopes[scope].layers) {
    sources[layer.level] = {
      type: 'vector',
      tiles: [mapAssetUrl(base, layer.url, origin)],
      minzoom: 0,
      maxzoom: layer.maxzoom,
      bounds: layer.bounds,
      promoteId: 'regionId',
      attribution: mapAttributions(scope)
        .map(
          (credit) =>
            `<a href="${credit.url}" target="_blank" rel="noopener noreferrer">${credit.label}</a>`,
        )
        .join(' · '),
    };
    const visibility = layer.level === level || layer.level === 'border' ? 'visible' : 'none';
    if (layer.level !== 'border')
      layers.push({
        id: layer.level + '-fill',
        type: 'fill',
        source: layer.level,
        'source-layer': 'regions',
        layout: { visibility },
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'fill'], '#f5f8f3'],
          'fill-opacity': boundaryFillOpacity(provider),
        },
      });
    layers.push({
      id: layer.level + '-line',
      type: 'line',
      source: layer.level,
      'source-layer': 'regions',
      layout: { visibility },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          '#cf762b',
          ['boolean', ['feature-state', 'hover'], false],
          '#548774',
          '#8ca49d',
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          2,
          ['boolean', ['feature-state', 'hover'], false],
          1.5,
          layer.level === 'county' ? 0.5 : 1,
        ],
      },
    });
  }
  if (provider) {
    sources.labels = { type: 'raster', tiles: provider.labels, tileSize: 256 };
    layers.push({ id: 'labels', source: 'labels', type: 'raster' });
  }
  sources.points = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  layers.push({
    id: 'points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-radius': 4,
      'circle-color': ['case', ['boolean', ['get', 'marked'], false], '#26775b', '#438fae'],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#fff',
    },
  });
  sources['visited-markers'] = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 44,
    // Keep coincident markers clustered through the map's maximum zoom (15).
    // They stay clickable as a member list instead of becoming stacked icons.
    clusterMaxZoom: 15,
    maxzoom: 16,
  };
  layers.push(
    {
      id: 'visited-clusters',
      type: 'symbol',
      source: 'visited-markers',
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': ['concat', 'visited-cluster-', ['to-string', ['get', 'point_count']]],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: 'visited-markers',
      type: 'symbol',
      source: 'visited-markers',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['concat', 'visited-', ['get', 'kind']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  );
  return { version: 8, sources, layers };
}
