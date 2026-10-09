import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodeCatalogResponse } from '../app/catalog-loader.js';
import { createMapStyle } from '../features/maps/style.js';
import { mapAssetUrl, tianditu } from '../features/maps/types.js';
import { createPolygonHitPolicy, pointInPolygon } from '../features/maps/polygon-hit-policy.js';
import { chinaBoundaryFeatureDiff } from '../features/maps/china-boundaries.js';
import { manifest } from './map-fixtures.js';

describe('current map resources', () => {
  it('preserves tile placeholders and resolves PMTiles beneath a deployment subpath', () => {
    expect(mapAssetUrl('/fangyu/', 'tiles/{z}/{x}/{y}.pbf', 'https://example.com/fangyu/')).toBe(
      'https://example.com/fangyu/tiles/{z}/{x}/{y}.pbf',
    );
    const style = createMapStyle(
      manifest,
      'china',
      'province',
      null,
      '/fangyu/',
      'https://example.com/fangyu/',
    );
    expect(style.sources.province).toMatchObject({
      type: 'vector',
      promoteId: 'regionId',
      url: 'pmtiles://https://example.com/fangyu/maps/china-province.pmtiles',
    });
  });

  it('creates one isolated GeoJSON source and layer set for each China boundary rule group', () => {
    const withOptions = structuredClone(manifest);
    withOptions.scopes.china!.boundaryOptions = 'maps/china-boundary-options.json.gz';
    withOptions.scopes.china!.boundaryOptionGroups = 3;
    const style = createMapStyle(
      withOptions,
      'china',
      'province',
      null,
      '/',
      'https://example.com/',
    );
    for (const index of [0, 1, 2]) {
      expect(style.sources[`china-options-${index}`]).toMatchObject({
        type: 'geojson',
        promoteId: 'regionId',
      });
      expect(style.layers.some((layer) => layer.id === `china-options-province-fill-${index}`)).toBe(
        true,
      );
    }
    expect(style.sources['china-options']).toBeUndefined();
  });

  it('decodes catalogs whether the HTTP layer already decompressed them or not', async () => {
    const sample = JSON.stringify({ version: 'test', entries: [] });
    const plain = await decodeCatalogResponse(
      new Response(sample, { headers: { 'Content-Encoding': 'gzip' } }),
    );
    const zipped = await decodeCatalogResponse(new Response(new Uint8Array(gzipSync(sample))));
    expect(plain).toEqual(zipped);
    expect(plain.version).toBe('test');
  });

  it('requires a public provider key and keeps layer kinds distinct', () => {
    expect(tianditu('')).toBeNull();
    expect(tianditu('test-public-browser-key')!.tiles[0]).toContain('vec_w');
    expect(tianditu('test-public-browser-key', 'satellite')!.tiles[0]).toContain('img_w');
  });

  it('preserves polygon holes and treats border points as hits', () => {
    const polygon = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
        [3, 3],
      ],
    ];
    expect(pointInPolygon([1, 1], polygon)).toBe(true);
    expect(pointInPolygon([5, 5], polygon)).toBe(false);
    expect(pointInPolygon([0, 5], polygon)).toBe(true);
    const policy = createPolygonHitPolicy([polygon], []);
    expect(policy([1, 1])).toBe(false);
    expect(policy([5, 5])).toBe(true);
  });

  it('creates an incremental diff for a changed special-boundary variant', () => {
    const unchangedGeometry = { type: 'Polygon' as const, coordinates: [] };
    const previous = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          id: 'park',
          properties: { regionId: 'park', level: 'county' },
          geometry: { type: 'Polygon' as const, coordinates: [] },
        },
        {
          type: 'Feature' as const,
          id: 'huzhou',
          properties: { regionId: 'huzhou', level: 'county' },
          geometry: { type: 'Polygon' as const, coordinates: [] },
        },
        {
          type: 'Feature' as const,
          id: 'unchanged',
          properties: { regionId: 'unchanged', level: 'county' },
          geometry: unchangedGeometry,
        },
      ],
    };
    const next = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          id: 'huzhou',
          properties: { regionId: 'huzhou', level: 'county', variant: 'merged' },
          geometry: { type: 'MultiPolygon' as const, coordinates: [] },
        },
        {
          type: 'Feature' as const,
          id: 'district',
          properties: { regionId: 'district', level: 'county' },
          geometry: { type: 'Polygon' as const, coordinates: [] },
        },
        {
          type: 'Feature' as const,
          id: 'unchanged',
          properties: { regionId: 'unchanged', level: 'county' },
          geometry: unchangedGeometry,
        },
      ],
    };
    expect(chinaBoundaryFeatureDiff(previous, next)).toEqual({
      remove: ['park'],
      add: [next.features[1]],
      update: [
        {
          id: 'huzhou',
          newGeometry: next.features[0]!.geometry,
          removeAllProperties: true,
          addOrUpdateProperties: [
            { key: 'regionId', value: 'huzhou' },
            { key: 'level', value: 'county' },
            { key: 'variant', value: 'merged' },
          ],
        },
      ],
    });
  });
});
