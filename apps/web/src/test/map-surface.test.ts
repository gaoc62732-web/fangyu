import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Feature, FeatureCollection } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { useAppStore } from '../app/store.js';
import { airport, beijing } from './fixtures.js';
import { manifest } from './map-fixtures.js';
import { setBasemapEnabled } from '../features/maps/basemap-settings.js';
import VisitedMapLayers from '../components/VisitedMapLayers.vue';

const lib = vi.hoisted(() => {
  class MockMap {
    events: Record<string, (event?: unknown) => void> = {};
    source = {
      setData: vi.fn<(data: FeatureCollection) => void>(),
      getClusterLeaves: vi.fn<() => Promise<Feature[]>>(async () => []),
    };
    canvas = document.createElement('canvas');
    hasImage = () => true;
    addImage = vi.fn();
    setMissingStyleImageResolver = vi.fn();
    getLayer = (id: string) => ({ id });
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    setFeatureState = vi.fn();
    setFilter = vi.fn();
    fitBounds = vi.fn();
    jumpTo = vi.fn();
    easeTo = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    queryRenderedFeatures = vi.fn<() => MapGeoJSONFeature[]>(() => []);
    getZoom = () => 12;
    project = () => ({ x: 0, y: 0 });
    zoomTo = vi.fn();
    getCenter = () => ({ toArray: () => [116.4, 39.9] });
    getCanvas = () => this.canvas;
    getSource = () => this.source;
    on(name: string, callback: (event?: unknown) => void) {
      this.events[name] = callback;
    }
    constructor() {
      if (state.fail) throw Error('WebGL unavailable');
      state.maps.push(this);
    }
  }
  const state = { maps: [] as MockMap[], fail: false, MockMap };
  return state;
});
vi.mock('maplibre-gl', () => ({ Map: lib.MockMap, setWorkerUrl: vi.fn(), addProtocol: vi.fn() }));
vi.mock('@fangyu/map-renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fangyu/map-renderer')>()),
  CanvasMapRenderer: class {
    setScene = vi.fn();
    fit = vi.fn();
    destroy = vi.fn();
    camera = () => undefined;
    setCamera = vi.fn();
    projectPoint = () => [0, 0];
  },
}));
import MapSurface from '../components/MapSurface.vue';
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(async () => {
  lib.maps = [];
  lib.fail = false;
  setBasemapEnabled(true);
  await useAppStore().load();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('map-manifest.json') ? manifest : { type: 'FeatureCollection', features: [] },
    })),
  );
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});
async function open() {
  wrapper = mount(MapSurface, { props: { scope: 'china', selected: beijing, points: [] } });
  await flushPromises();
  await vi.dynamicImportSettled();
  await flushPromises();
  return wrapper;
}

describe('current map lifecycle', () => {
  it.each([false, true])(
    'handles region clicks and hover only outside point mode (%s)',
    async (pointMode) => {
      wrapper = mount(MapSurface, {
        props: { scope: 'china', level: 'province', pointMode, points: [] },
      });
      await vi.dynamicImportSettled();
      await flushPromises();
      const map = lib.maps[0]!;
      map.events['style.load']!();
      const region = {
        properties: { regionId: beijing, name: '北京市' },
        layer: { id: 'province-fill' },
        geometry: { type: 'Polygon', coordinates: [] },
      } as unknown as MapGeoJSONFeature;
      map.queryRenderedFeatures.mockImplementation((...args: unknown[]) => {
        const layers = (args[1] as { layers: string[] }).layers;
        return layers.includes('province-fill') ? [region] : [];
      });
      const event = { point: { x: 100, y: 100 }, lngLat: { lng: 116.4, lat: 39.9 } };
      map.events.mousemove!(event);
      map.events.click!(event);
      await flushPromises();
      expect(wrapper.emitted('select')).toEqual(pointMode ? undefined : [[beijing]]);
      expect(wrapper.find('.map-hover-card').exists()).toBe(!pointMode);
      expect(map.canvas.style.cursor).toBe(pointMode ? '' : 'pointer');
    },
  );

  it('uses the existing boundary basemap and offers only point preferences and a separate legend in point mode', async () => {
    wrapper = mount(MapSurface, { props: { scope: 'china', pointMode: true, points: [] } });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(wrapper.find('.basemap-settings').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('导出');
    expect(wrapper.text()).not.toContain('选中范围');
    expect(wrapper.find('.atlas-map-sources').exists()).toBe(false);
    expect(wrapper.find('.atlas-map-legend').attributes('open')).toBeUndefined();
    await wrapper.find('[aria-label="点位关联设置"]').trigger('click');
    expect(wrapper.emitted('settings')).toHaveLength(1);
    const current = lib.maps[0]!;
    setBasemapEnabled(false);
    await flushPromises();
    expect(current.remove).not.toHaveBeenCalled();
    expect(lib.maps).toHaveLength(1);
  });
  it('inherits a point-page camera and preserves it while changing category, details and preview', async () => {
    const store = useAppStore();
    wrapper = mount(MapSurface, {
      props: {
        scope: 'china',
        pointMode: true,
        selected: beijing,
        points: store.rows,
        initialCamera: { center: [116.4, 39.9], zoom: 12 },
      },
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [116.4, 39.9], zoom: 12 });
    map.fitBounds.mockClear();
    map.jumpTo.mockClear();
    map.easeTo.mockClear();
    await wrapper.setProps({ category: 'airport', previewRegions: [beijing], selected: '' });
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(wrapper.findComponent(VisitedMapLayers).exists()).toBe(false);
    expect(wrapper.find('.point-dot.clustered').text()).toBe('2');
  });

  it('smoothly reveals a point once when the inherited viewport is empty', async () => {
    const store = useAppStore();
    wrapper = mount(MapSurface, {
      props: {
        scope: 'china',
        pointMode: true,
        points: [store.rows[0]!],
        initialCamera: { center: [110, 30], zoom: 8 },
      },
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    const map = lib.maps[0]!;
    map.project = () => ({ x: 900, y: 900 });
    map.events['style.load']!();
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [116.4, 39.9], duration: 650 }),
    );
    map.easeTo.mockClear();
    await wrapper.setProps({ category: 'railway-station', previewRegions: [beijing] });
    expect(map.easeTo).not.toHaveBeenCalled();
  });
  it('keeps the list available without starting an engine when no boundary is published', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ version: 'test', scopes: {} })),
    );
    const current = await open();
    expect(lib.maps).toHaveLength(0);
    expect(current.find('.map-surface').attributes('data-map-mode')).toBe('unavailable');
    expect(current.text()).toContain('该专题尚无已发布的边界地图');
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it('ignores an old manifest response after switching scopes', async () => {
    let resolveManifest!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
    );
    wrapper = mount(MapSurface, { props: { scope: 'china' } });
    await wrapper.setProps({ scope: 'france' });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(lib.maps).toHaveLength(1);
    resolveManifest(new Response(JSON.stringify(manifest)));
    await flushPromises();
    expect(lib.maps).toHaveLength(1);
    expect(lib.maps[0]!.remove).not.toHaveBeenCalled();
  });

  it('retains the camera when switching the visual basemap', async () => {
    await open();
    const previous = lib.maps[0]!;
    previous.events['style.load']!();
    setBasemapEnabled(false);
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
    const next = lib.maps[1]!;
    next.events['style.load']!();
    expect(previous.remove).toHaveBeenCalledOnce();
    expect(next.jumpTo).toHaveBeenCalledWith({ center: [116.4, 39.9], zoom: 12 });
  });

  it('selects cluster members and focuses their coordinates on the active map', async () => {
    const store = useAppStore();
    store.commit((session) => {
      session.markEntry(airport, true);
      session.updatePreferences({
        mapLayers: { visitedAirports: true, visitedWorldHeritage: false },
      });
    });
    await store.flush();
    const current = await open();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    const layers = current.findComponent(VisitedMapLayers);
    const marker = layers.props('result').markers[0]!;
    map.source.getClusterLeaves.mockResolvedValueOnce([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: marker.coordinates },
        properties: { id: marker.id },
      },
    ]);
    map.queryRenderedFeatures.mockReturnValueOnce([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: marker.coordinates },
        properties: { cluster: true, cluster_id: 1, point_count: 1 },
      } as unknown as MapGeoJSONFeature,
    ]);
    map.events.click!({ point: { x: 20, y: 20 }, lngLat: { lng: 116.4, lat: 39.9 } });
    await flushPromises();
    expect(layers.props('selected').map((item) => item.id)).toEqual([marker.id]);
    expect(map.easeTo).toHaveBeenCalledWith({
      center: marker.coordinates,
      zoom: 14,
      duration: 250,
    });
  });

  it.each(['close', 'unmount', 'switch'] as const)(
    'ignores delayed cluster selection after %s',
    async (action) => {
      const store = useAppStore();
      store.commit((session) => {
        session.markEntry(airport, true);
        session.updatePreferences({
          mapLayers: { visitedAirports: true, visitedWorldHeritage: false },
        });
      });
      await store.flush();
      const current = await open();
      const map = lib.maps[0]!;
      map.events['style.load']!();
      const layers = current.findComponent(VisitedMapLayers);
      const marker = layers.props('result').markers[0]!;
      let resolveLeaves!: (leaves: Feature[]) => void;
      map.source.getClusterLeaves.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLeaves = resolve;
          }),
      );
      map.queryRenderedFeatures.mockReturnValueOnce([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: marker.coordinates },
          properties: { cluster: true, cluster_id: 1, point_count: 1 },
        } as unknown as MapGeoJSONFeature,
      ]);
      map.events.click!({ point: { x: 20, y: 20 }, lngLat: { lng: 116.4, lat: 39.9 } });
      expect(map.source.getClusterLeaves).toHaveBeenCalledOnce();
      if (action === 'close') layers.vm.$emit('close');
      else if (action === 'switch') await current.setProps({ scope: 'france' });
      else {
        current.unmount();
        wrapper = undefined;
      }
      resolveLeaves([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: marker.coordinates },
          properties: { id: marker.id },
        },
      ]);
      await flushPromises();
      expect(map.easeTo).not.toHaveBeenCalled();
      if (action !== 'unmount') expect(layers.props('selected')).toHaveLength(0);
    },
  );

  it('applies the latest points and selected region when the style is ready', async () => {
    const current = await open();
    const map = lib.maps[0]!;
    const rows = useAppStore().rows;
    await current.setProps({ points: rows });
    expect(map.fitBounds).not.toHaveBeenCalled();
    map.events['style.load']!();
    await flushPromises();
    expect(
      map.source.setData.mock.calls.some(
        ([data]) =>
          data.features.map((feature) => feature.id).join() === rows.map((row) => row.id).join(),
      ),
    ).toBe(true);
    expect(map.fitBounds.mock.calls[0]![0]).toEqual(manifest.scopes.china.regionBounds[beijing]);
  });

  it('falls back to simplified geometry when WebGL fails', async () => {
    lib.fail = true;
    const current = await open();
    expect(current.text()).toContain('已切换为简化地图');
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/maps/china.json');
    expect(urls.some((url) => url.includes('/geometry/'))).toBe(false);
  });

  it('keeps recovery controls available for resource errors after the style loads', async () => {
    const current = await open();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    map.events.error!({ error: Error('resource unavailable') });
    await flushPromises();
    expect(current.text()).toContain('地图资源暂时无法完整加载');
    expect(current.findAll('button').some((button) => button.text() === '重试地图')).toBe(true);
    expect(current.findAll('button').some((button) => button.text() === '使用简化地图')).toBe(true);
    expect(map.remove).not.toHaveBeenCalled();
  });

  it('releases the map and ignores callbacks from an unmounted component', async () => {
    const current = await open();
    const map = lib.maps[0]!;
    current.unmount();
    wrapper = undefined;
    map.events['style.load']!();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});
