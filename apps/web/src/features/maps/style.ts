import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { Scope } from '@fangyu/contracts';
import { POINT_MAP_APPEARANCE } from '@fangyu/map-renderer';
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
    provider.kind === 'satellite' ? 0.65 : 0.32,
    provider.kind === 'satellite' ? 0.08 : 0,
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
  pointMode = false,
): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const layers: StyleSpecification['layers'] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#eef4f3' } },
  ];
  const labels: StyleSpecification['layers'] = [];
  if (provider?.style) {
    const style = structuredClone(provider.style);
    for (const [id, source] of Object.entries(style.sources)) sources['base-' + id] = source;
    for (const layer of style.layers) {
      // China uses the acquired polygon outlines. National borders are omitted
      // from the custom basemap globally; other scopes may keep its province lines.
      if (scope === 'china' && 'source-layer' in layer && layer['source-layer'] === 'boundary')
        continue;
      // Local names are the default. Only the China map prefers Chinese tags;
      // apply this to the clone so switching scopes cannot change the base style.
      if (provider.id === 'openfreemap' && scope === 'china' && layer.type === 'symbol') {
        const field = layer.layout?.['text-field'];
        if (Array.isArray(field) && field[0] === 'get' && field[1] === 'name') {
          layer.layout!['text-field'] = [
            'coalesce',
            ['get', 'name:zh-Hans'],
            ['get', 'name:zh'],
            ['get', 'name'],
          ];
        }
      }
      layer.id = 'base-' + layer.id;
      if ('source' in layer) layer.source = 'base-' + layer.source;
      (layer.type === 'symbol' ? labels : layers).push(layer);
    }
  } else if (provider) {
    sources.basemap = {
      type: 'raster',
      tiles: provider.tiles,
      tileSize: 256,
      minzoom: 1,
      maxzoom: 18,
      attribution: provider.attribution,
    };
    layers.push({ id: 'basemap', source: 'basemap', type: 'raster' });
  }
  if (provider && !provider.style) {
    sources.labels = {
      type: 'raster',
      tiles: provider.labels,
      tileSize: 256,
      minzoom: 1,
      maxzoom: 18,
    };
    labels.push({ id: 'labels', source: 'labels', type: 'raster' });
  }
  if (pointMode) {
    layers.push(...labels, {
      id: 'point-basemap-mask',
      type: 'background',
      paint: {
        'background-color': POINT_MAP_APPEARANCE.maskColor,
        'background-opacity': POINT_MAP_APPEARANCE.maskOpacity,
      },
    });
  }
  for (const layer of manifest.scopes[scope].layers) {
    sources[layer.level] = {
      type: 'vector',
      ...(layer.archive
        ? { url: 'pmtiles://' + mapAssetUrl(base, layer.url, origin) }
        : { tiles: [mapAssetUrl(base, layer.url, origin)] }),
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
          'fill-opacity': pointMode ? 0 : boundaryFillOpacity(provider),
        },
      });
    layers.push({
      id: layer.level + '-line',
      type: 'line',
      source: layer.level,
      'source-layer': 'regions',
      // Legacy border data also contains coarse province polygons. Only draw
      // independent border lines over the administrative boundary layers.
      ...(layer.level === 'border'
        ? {
            filter:
              scope === 'china'
                ? [
                    'all',
                    ['==', ['geometry-type'], 'LineString'],
                    ['in', ['get', 'boundaryKind'], ['literal', ['land', 'maritime-dash']]],
                  ]
                : ['==', ['geometry-type'], 'LineString'],
          }
        : {}),
      layout: { visibility, 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': pointMode
          ? layer.level === 'border'
            ? POINT_MAP_APPEARANCE.borderColor
            : POINT_MAP_APPEARANCE.boundaryColor
          : [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#cf762b',
              ['boolean', ['feature-state', 'hover'], false],
              '#548774',
              layer.level === 'border' ? '#263f45' : '#8ca49d',
            ],
        'line-opacity': pointMode ? POINT_MAP_APPEARANCE.boundaryOpacity : 1,
        'line-width': pointMode
          ? layer.level === 'border'
            ? 1.4
            : layer.level === 'county'
              ? 0.5
              : 1
          : [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              2,
              ['boolean', ['feature-state', 'hover'], false],
              1.5,
              layer.level === 'border' ? 2.6 : layer.level === 'county' ? 0.5 : 1,
            ],
      },
    });
  }
  if (pointMode) {
    // Separate from the boundary level: county associations stay county-sized
    // even while the user is viewing province outlines.
    for (const layer of manifest.scopes[scope].layers.filter((l) => l.level !== 'border'))
      layers.push({
        id: layer.level + '-point-highlight',
        type: 'fill',
        source: layer.level,
        'source-layer': 'regions',
        filter: ['in', ['get', 'regionId'], ['literal', []]],
        layout: { visibility: 'none' },
        paint: {
          'fill-color': POINT_MAP_APPEARANCE.highlightColor,
          'fill-opacity': POINT_MAP_APPEARANCE.highlightOpacity,
          'fill-antialias': false,
        },
      });
  } else layers.push(...labels);
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
  return {
    version: 8,
    ...(provider?.style?.glyphs ? { glyphs: provider.style.glyphs } : {}),
    ...(provider?.style?.sprite ? { sprite: provider.style.sprite } : {}),
    sources,
    layers,
  };
}
