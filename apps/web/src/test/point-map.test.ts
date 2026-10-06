import { beforeEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useAppStore } from '../app/store.js';
import { useMapScene } from '../features/maps/use-map-scene.js';
import { createMapStyle } from '../features/maps/style.js';
import { tianditu, type TiledMapProps } from '../features/maps/types.js';
import { beijing, city, dongcheng } from './fixtures.js';
import { manifest } from './map-fixtures.js';

const geometry: GeoJSON.MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
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
    ],
    [
      [
        [12, 0],
        [14, 0],
        [14, 2],
        [12, 2],
        [12, 0],
      ],
    ],
  ],
};
const features: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry, properties: { regionId: beijing, level: 'province' } },
    { type: 'Feature', geometry, properties: { regionId: dongcheng, level: 'county' } },
  ],
};
function drawing(previewRegions?: string[]) {
  const props: TiledMapProps = {
    scope: 'china',
    selected: beijing,
    level: 'province',
    category: '',
    pointMode: true,
    previewRegions,
  };
  return useMapScene(props, ref(), ref(8), ref('province'), ref(features));
}
beforeEach(async () => {
  await useAppStore().load();
});

describe('point exploration map', () => {
  it('starts with neutral boundaries and does not preview the inherited regional selection', () => {
    const scene = drawing().scene();
    expect(scene.features).toHaveLength(1);
    expect(scene.features[0]).toMatchObject({
      interactive: false,
      selected: false,
      fill: 'transparent',
    });
  });
  it('previews exact county geometry at province level without replacing holes or exclaves', () => {
    const d = drawing([dongcheng]);
    const scene = d.scene();
    expect(scene.features.find((f) => f.id === beijing)?.selected).toBe(false);
    const county = scene.features.find((f) => f.id === dongcheng)!;
    expect(county).toMatchObject({ selected: true, interactive: false, boundary: false });
    expect(county.geometry).toEqual(geometry);
    expect(d.previewTargets.value).toEqual([dongcheng]);
  });
  it('avoids overlapping parent and child preview fills and permits clearing all previews', () => {
    expect(drawing([beijing, dongcheng, dongcheng]).previewTargets.value).toEqual([beijing]);
    expect(
      drawing([])
        .scene()
        .features.every((f) => !f.selected),
    ).toBe(true);
  });
  it('fills a city only once when its geometry also appears in the county layer', () => {
    const duplicate: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: ['city', 'county'].map((level) => ({
        type: 'Feature',
        geometry,
        properties: { regionId: city, level },
      })),
    };
    const props: TiledMapProps = {
      scope: 'china',
      selected: '',
      level: 'county',
      category: '',
      pointMode: true,
      previewRegions: [city],
    };
    const d = useMapScene(props, ref(), ref(8), ref('county'), ref(duplicate));
    expect(d.previewIds('city')).toEqual([city]);
    expect(d.previewIds('county')).toEqual([]);
    expect(d.scene().features.filter((f) => f.selected)).toHaveLength(1);
  });
  it('puts the mask above base labels and the range fill and points above the mask', () => {
    const style = createMapStyle(
      manifest,
      'china',
      'province',
      tianditu('public-key-example'),
      '/',
      'http://localhost/',
      true,
    );
    const index = (id: string) => style.layers.findIndex((l) => l.id === id);
    expect(index('labels')).toBeLessThan(index('point-basemap-mask'));
    expect(index('point-basemap-mask')).toBeLessThan(index('province-line'));
    expect(index('point-basemap-mask')).toBeLessThan(index('province-point-highlight'));
    expect(index('province-point-highlight')).toBeLessThan(index('points'));
    expect(style.layers.find((l) => l.id === 'province-fill')).toMatchObject({
      paint: { 'fill-opacity': 0 },
    });
    const line = style.layers.find((l) => l.id === 'province-line')!;
    if (line.type !== 'line') throw Error('Missing boundary line');
    expect(line.paint?.['line-color']).not.toBeInstanceOf(Array);
    expect(line.paint?.['line-width']).not.toBeInstanceOf(Array);
    const regional = createMapStyle(manifest, 'china', 'province', null, '/', 'http://localhost/');
    expect(regional.layers.some((l) => l.id === 'point-basemap-mask')).toBe(false);
    expect(regional.layers.find((l) => l.id === 'province-fill')).toMatchObject({
      paint: { 'fill-opacity': 1 },
    });
  });
});
