import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { footprintPng, type RenderFeature } from '@fangyu/map-renderer';
import { decodeCatalogResponse } from '../app/catalog-loader.js';
import { gzipSync } from 'node:zlib';
import { createMapStyle } from '../features/maps/style.js';
import { tianditu } from '../features/maps/types.js';
import { catalog } from './fixtures.js';
import legacy from '../features/achievements/legacy.json';
const root = resolve(import.meta.dirname, '../../../..');
const assets = resolve(root, 'data/generated/web');
if (existsSync('C:/Windows/Fonts/msyh.ttc'))
  GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'sans-serif');
const require = createRequire(import.meta.url);
const tileRequire = createRequire(require.resolve('vt-pbf'));
const { VectorTile } = tileRequire('@mapbox/vector-tile');
const Pbf = tileRequire('pbf');
const mapRequire = createRequire(require.resolve('maplibre-gl/package.json'));
const { validateStyleMin } = mapRequire('@maplibre/maplibre-gl-style-spec');
afterEach(() => vi.restoreAllMocks());
describe('offline map assets and export', () => {
  it('serves stable region IDs in every MVT layer without requiring full source geometries', () => {
    const manifest = JSON.parse(readFileSync(resolve(assets, 'map-manifest.json'), 'utf8'));
    const ids = new Set(catalog.regions.map((r) => r.id));
    for (const scope of Object.values(manifest.scopes) as any[])
      for (const layer of scope.layers) {
        const tile = new VectorTile(
          new Pbf(
            readFileSync(
              resolve(
                assets,
                layer.url.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'),
              ),
            ),
          ),
        );
        expect(tile.layers.regions.length).toBeGreaterThan(0);
        const region = tile.layers.regions.feature(0).properties.regionId;
        if (layer.level !== 'border') expect(ids.has(region)).toBe(true);
      }
  });
  it('preserves tile placeholders and validates the MapLibre style under a subpath', () => {
    const manifest = JSON.parse(readFileSync(resolve(assets, 'map-manifest.json'), 'utf8'));
    const style = createMapStyle(
      manifest,
      'china',
      '',
      null,
      '/fangyu/',
      'http://localhost/fangyu/',
    );
    expect((style.sources.province as any).tiles[0]).toBe(
      'http://localhost/fangyu/tiles/china/province/{z}/{x}/{y}.pbf',
    );
    expect(validateStyleMin(style).map((e: any) => e.message)).toEqual([]);
  });
  it('loads catalogs with or without HTTP gzip decoding', async () => {
    const sample = JSON.stringify({ version: 'test', entries: [] });
    const plain = await decodeCatalogResponse(
      new Response(sample, { headers: { 'Content-Encoding': 'gzip' } }),
    );
    const zipped = await decodeCatalogResponse(new Response(new Uint8Array(gzipSync(sample))));
    expect(plain).toEqual(zipped);
    expect(plain.version).toBe('test');
  });
  it('requires an explicit public provider key and keeps the original achievement metadata', () => {
    expect(tianditu('')).toBeNull();
    expect(tianditu('test-public-browser-key')!.tiles[0]).toContain('vec_w');
    expect(legacy.ACH_NAMES).toHaveLength(19);
    expect(legacy.ACH_STEPS[18]).toBe(2500);
    expect(legacy.WORLD_SECTIONS.map((s) => s[1])).toEqual([
      '寰行',
      '洲行',
      '殊方',
      '云程',
      '遗珍',
    ]);
    expect(
      readFileSync(resolve(root, 'apps/web/assets/fangyu-seal.woff2')).subarray(0, 4).toString(),
    ).toBe('wOF2');
  });
  it.each([
    ['china', 1920],
    ['world', 1920],
    ['china', 3840],
  ] as const)('renders and decodes %s footprint PNG at %i pixels', async (scope, width) => {
    const native = createCanvas(1, 1);
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return create(tag);
      return Object.assign(native, {
        toBlob: (callback: (b: Blob) => void) =>
          callback(new Blob([new Uint8Array(native.toBuffer('image/png'))], { type: 'image/png' })),
      });
    }) as typeof document.createElement);
    const source = JSON.parse(readFileSync(resolve(assets, 'maps', scope + '.json'), 'utf8'));
    const features: RenderFeature[] = source.features
      .filter((f: any) => f.properties.level === (scope === 'china' ? 'province' : 'country'))
      .map((f: any, i: number) => ({
        id: f.properties.regionId,
        name: f.properties.name,
        geometry: f.geometry,
        fill: i % 3 === 0 ? '#76aa82' : '#e3e9df',
      }));
    const blob = await footprintPng(
      features,
      [{ id: 'fixture', name: '坐标示例', coords: [116.4, 39.9], marked: true }],
      {
        width,
        title: scope === 'china' ? '中国 · 足迹导出校验' : '世界 · 足迹导出校验',
        subtitle: '测试图，不含个人记录',
        world: scope === 'world',
        legend: [
          { label: '未到达', color: '#e3e9df' },
          { label: '已到达', color: '#76aa82' },
        ],
      },
    );
    const bytes = Buffer.from(await blob.arrayBuffer());
    const decoded = await loadImage(bytes);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(Math.round(width * 0.68));
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(25000);
    const color = native.getContext('2d').getImageData(0, 0, width, Math.round(width * 0.68)).data;
    let green = 0;
    for (let i = 0; i < color.length; i += 4)
      if (color[i] === 118 && color[i + 1] === 170 && color[i + 2] === 130) green++;
    expect(green).toBeGreaterThan(1000);
    expect(green).toBeLessThan(width * Math.round(width * 0.68) * 0.45);
    mkdirSync(resolve(root, 'data/generated/verification'), { recursive: true });
    writeFileSync(
      resolve(root, 'data/generated/verification', scope + '-' + width + '.png'),
      bytes,
    );
  });
});
