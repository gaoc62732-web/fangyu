import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { decodeCatalogResponse } from '../app/catalog-loader.js';
import { createMapStyle } from '../features/maps/style.js';
import { mapAssetUrl, tianditu } from '../features/maps/types.js';
import { createPolygonHitPolicy, pointInPolygon } from '../features/maps/polygon-hit-policy.js';
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
      url: 'pmtiles://https://example.com/fangyu/maps/china.pmtiles',
    });
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
});
