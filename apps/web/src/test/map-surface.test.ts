import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw } from 'vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { initialWorkspace } from '../app/workspace.js';
import { useAppStore } from '../app/store.js';
import { createSession, beijing } from './fixtures.js';
const lib = vi.hoisted(() => ({ maps: [] as any[], fail: false }));
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  NavigationControl: class {},
  Map: class {
    events: Record<string, Function> = {};
    source = { setData: vi.fn(), getClusterExpansionZoom: vi.fn(async () => 15) };
    addControl = vi.fn();
    addImage = vi.fn();
    getLayer = (id: string) => ({ id });
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    setFeatureState = vi.fn();
    setFilter = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    queryRenderedFeatures = vi.fn(() => [] as any[]);
    getZoom = () => 15;
    getCenter = () => ({ lng: 116.4, lat: 39.9 });
    getBounds = () => ({
      getWest: () => 110,
      getSouth: () => 30,
      getEast: () => 120,
      getNorth: () => 40,
    });
    getCanvas = () => ({ style: { cursor: '' } });
    project = (coordinates: number[]) => ({ x: coordinates[0]! * 100, y: coordinates[1]! * 100 });
    getSource = () => this.source;
    on(name: string, callback: Function) {
      this.events[name] = callback;
    }
    constructor(public options: any) {
      if (lib.fail) throw Error('WebGL unavailable');
      lib.maps.push(this);
    }
  },
}));
import MapSurface from '../components/MapSurface.vue';
const assets = resolve(import.meta.dirname, '../../../../data/generated/web');
const manifest = JSON.parse(readFileSync(resolve(assets, 'map-manifest.json'), 'utf8'));
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  lib.maps = [];
  lib.fail = false;
  setActivePinia(createPinia());
  const store = useAppStore();
  store.session = markRaw(createSession());
  store.loading = false;
  store.revision++;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal('Path2D', Path2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return createCanvas(this.width || 1, this.height || 1).getContext('2d') as any;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('map-manifest.json')
          ? manifest
          : JSON.parse(readFileSync(resolve(assets, 'maps/china.json'), 'utf8')),
    })),
  );
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function open() {
  const state = initialWorkspace('china').map;
  wrapper = mount(MapSurface, {
    props: { scope: 'china', state, selected: '', focused: '', points: [] },
  });
  await flushPromises();
  return { wrapper, state };
}
describe('map lifecycle and selection', () => {
  it('applies the latest points and pending region fit after map load', async () => {
    const { wrapper } = await open();
    const map = lib.maps[0];
    const rows = useAppStore()
      .rows.filter((e) => e.coordinates)
      .slice(0, 2);
    await wrapper.setProps({ points: rows });
    (wrapper.vm as any).fitRegion(beijing);
    expect(map.fitBounds).not.toHaveBeenCalled();
    map.events.load();
    await flushPromises();
    expect(map.source.setData.mock.lastCall[0].features.map((f: any) => f.id)).toEqual(
      rows.map((r) => r.id),
    );
    expect(map.fitBounds.mock.lastCall[0]).toEqual(manifest.scopes.china.regionBounds[beijing]);
    const fits = map.fitBounds.mock.calls.length;
    await wrapper.setProps({ focused: rows[0]!.id, selected: beijing });
    await flushPromises();
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
    expect(map.setFeatureState).toHaveBeenCalled();
  });
  it('zooms clusters and reveals collision-hidden projects as candidates', async () => {
    const { wrapper } = await open();
    const map = lib.maps[0];
    map.events.load();
    map.queryRenderedFeatures.mockReturnValue([
      { properties: { cluster_id: 1 }, geometry: { type: 'Point', coordinates: [116, 40] } },
    ]);
    await map.events.click({ point: { x: 11600, y: 4000 } });
    expect(map.easeTo).toHaveBeenCalledWith({ center: [116, 40], zoom: 15 });
    const first = useAppStore().rows.find((e) => e.coordinates)!;
    const rows = [
      { ...first, id: 'first', coordinates: [116, 40] as [number, number] },
      { ...first, id: 'second', coordinates: [116, 40] as [number, number] },
    ];
    await wrapper.setProps({ points: rows });
    map.queryRenderedFeatures.mockImplementation((_point: any, options: any) =>
      options.layers.includes('clusters') ? [] : [{ properties: { id: 'first' } }],
    );
    await map.events.click({ point: { x: 11600, y: 4000 } });
    expect(wrapper.emitted('candidates')?.[0]?.[0]).toEqual(['first', 'second']);
    expect(wrapper.emitted('select')).toBeUndefined();
  });
  it('loads only simplified geometry when WebGL initialization fails', async () => {
    lib.fail = true;
    const { wrapper } = await open();
    await flushPromises();
    expect(wrapper.text()).toContain('当前使用简化地图');
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/maps/china.json');
    expect(urls.some((url) => url.includes('/geometry/'))).toBe(false);
  });
});
