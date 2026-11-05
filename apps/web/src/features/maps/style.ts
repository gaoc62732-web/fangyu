import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import type { Scope } from '@fangyu/contracts';
import { POINT_MAP_APPEARANCE } from '@fangyu/map-renderer';
import { mapAssetUrl, type MapDataManifest, type BasemapProvider } from './types.js';
import { mapAttributions } from './data-attribution.js';
import { chinaBoundaryLayerId, chinaBoundarySourceId } from './china-boundaries.js';

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

export function boundaryOverlayFillColor(
  provider: BasemapProvider | null,
): string | ExpressionSpecification {
  const color: ExpressionSpecification = ['coalesce', ['feature-state', 'fill'], '#f5f8f3'];
  if (!provider) return color;
  return [
    'case',
    ['boolean', ['feature-state', 'recorded'], false],
    color,
    'rgba(0, 0, 0, 0)',
  ];
}

export function boundaryOverlayFillOpacity(
  provider: BasemapProvider | null,
): number | ExpressionSpecification {
  if (!provider) return 1;
  return [
    'case',
    ['boolean', ['feature-state', 'recorded'], false],
    provider.kind === 'satellite' ? 0.65 : 0.32,
    1,
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
          'fill-opacity': boundaryFillOpacity(provider),
          'fill-outline-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            '#548774',
            layer.level === 'county' ? '#8ca49d' : '#57726b',
          ],
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
                    ['==', ['get', 'boundaryKind'], 'land'],
                  ]
                : ['==', ['geometry-type'], 'LineString'],
          }
        : { filter: ['==', ['geometry-type'], 'LineString'] }),
      // A province coastline can contain thousands of vertices in one tile.
      // Round joins expand each vertex into several GPU vertices; on a long
      // ring that can exceed WebGL's 16-bit segment limit and wrap indices,
      // producing missing sections and stray diagonal lines. Bevel joins keep
      // the expansion bounded while preserving the boundary shape.
      layout: { visibility, 'line-join': 'bevel', 'line-cap': 'butt' },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#548774',
          layer.level === 'border' ? '#263f45' : '#8ca49d',
        ],
        'line-opacity': 1,
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1.5,
          layer.level === 'border' ? 2.6 : layer.level === 'county' ? 0.5 : 1,
        ],
      },
    });
  }
  if (scope === 'china' && manifest.scopes.china.boundaryOptions) {
    const administrativeLayers = layers.filter(
      (layer) =>
        layer.type === 'fill' &&
        'source' in layer &&
        ['province', 'city', 'county'].includes(String(layer.source)),
    );
    for (let index = 0; index < (manifest.scopes.china.boundaryOptionGroups || 0); index++) {
      const sourceId = chinaBoundarySourceId(index);
      sources[sourceId] = {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'regionId',
        maxzoom: 15,
        tolerance: 0,
      };
      for (const original of administrativeLayers) {
        const clone = structuredClone(original);
        const level = String('source' in original ? original.source : '');
        clone.id = chinaBoundaryLayerId(index, original.id);
        if ('source' in clone) clone.source = sourceId;
        if ('source-layer' in clone) delete clone['source-layer'];
        clone.filter = ['==', ['get', 'level'], level];
        clone.paint = {
          ...clone.paint,
          'fill-color': boundaryOverlayFillColor(provider),
          'fill-opacity': boundaryOverlayFillOpacity(provider),
        };
        layers.splice(layers.findIndex((layer) => layer.id === original.id) + 1, 0, clone);
      }
    }
    sources['china-options-lines'] = {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 15,
      tolerance: 0,
    };
    layers.push({
      id: 'china-options-tanggula-nominal-line',
      type: 'line',
      source: 'china-options-lines',
      filter: ['==', ['get', 'boundaryKind'], 'tanggula-nominal'],
      layout: { visibility: 'visible', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#8ca49d',
        'line-opacity': 1,
        'line-width': 1,
        'line-dasharray': [8, 5],
      },
    });
    layers.push({
      id: 'china-options-maritime-dash-line',
      type: 'line',
      source: 'china-options-lines',
      filter: ['==', ['get', 'boundaryKind'], 'maritime-dash'],
      layout: { visibility: 'visible', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#263f45',
        'line-opacity': 1,
        'line-width': 2.2,
        'line-dasharray': [1, 2],
      },
    });
  }
  // A selected feature's own line style can be covered by a neighbouring
  // polygon's shared edge. Redraw selected outlines after every ordinary and
  // configured boundary layer, while keeping them below the point-mode veil.
  const selectedOutlinePaint = {
    // FillBucket segments long polygon outlines to stay within WebGL's 16-bit
    // index limit; LineBucket expands every vertex and can overflow first.
    'fill-color': 'rgba(0, 0, 0, 0)',
    'fill-pattern': 'selected-region-hatch',
    'fill-outline-color': '#b84f16',
    'fill-opacity': 1,
  } as const;
  for (const layer of manifest.scopes[scope].layers.filter((item) => item.level !== 'border'))
    layers.push({
      id: layer.level + '-selected-outline',
      type: 'fill',
      source: layer.level,
      'source-layer': 'regions',
      filter: ['in', ['get', 'regionId'], ['literal', []]],
      layout: { visibility: layer.level === level ? 'visible' : 'none' },
      paint: selectedOutlinePaint,
    });
  if (scope === 'china' && manifest.scopes.china.boundaryOptions)
    for (let index = 0; index < (manifest.scopes.china.boundaryOptionGroups || 0); index++)
      for (const layer of manifest.scopes.china.layers.filter((item) => item.level !== 'border'))
        layers.push({
          id: chinaBoundaryLayerId(index, layer.level + '-selected-outline'),
          type: 'fill',
          source: chinaBoundarySourceId(index),
          filter: [
            'all',
            ['==', ['get', 'level'], layer.level],
            ['in', ['get', 'regionId'], ['literal', []]],
          ],
          layout: { visibility: layer.level === level ? 'visible' : 'none' },
          paint: selectedOutlinePaint,
        });
  // Keep the veil above administrative fills and boundaries, but below labels.
  sources['point-basemap-mask'] = {
    type: 'geojson',
    data: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
        ],
      },
    },
  };
  layers.push({
    id: 'point-basemap-mask',
    type: 'fill',
    source: 'point-basemap-mask',
    layout: { visibility: pointMode ? 'visible' : 'none' },
    paint: {
      'fill-color': POINT_MAP_APPEARANCE.maskColor,
      'fill-opacity': POINT_MAP_APPEARANCE.maskOpacity,
    },
  });
  // Both modes' layers stay in one style so route changes never call setStyle.
  layers.push(...labels);
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
  if (scope === 'china' && manifest.scopes.china.boundaryOptions)
    for (let index = 0; index < (manifest.scopes.china.boundaryOptionGroups || 0); index++)
      for (const layer of manifest.scopes[scope].layers.filter((l) => l.level !== 'border'))
        layers.push({
          id: chinaBoundaryLayerId(index, layer.level + '-point-highlight'),
          type: 'fill',
          source: chinaBoundarySourceId(index),
          filter: [
            'all',
            ['==', ['get', 'level'], layer.level],
            ['in', ['get', 'regionId'], ['literal', []]],
          ],
          layout: { visibility: 'none' },
          paint: {
            'fill-color': POINT_MAP_APPEARANCE.highlightColor,
            'fill-opacity': POINT_MAP_APPEARANCE.highlightOpacity,
            'fill-antialias': false,
          },
        });
  sources.points = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  layers.push({
    id: 'points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-radius': 4,
      'circle-color': ['case', ['boolean', ['get', 'marked'], false], POINT_MAP_APPEARANCE.visitedColor,
        ['boolean', ['get', 'partial'], false], POINT_MAP_APPEARANCE.partialColor, POINT_MAP_APPEARANCE.unvisitedColor],
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
