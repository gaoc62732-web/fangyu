import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Feature, FeatureCollection } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { useAppStore } from '../app/store.js';
import { airport, beijing, city, dongcheng } from './fixtures.js';
import { manifest } from './map-fixtures.js';
import type { ChinaBoundaryData } from '../features/maps/china-boundaries.js';
import { setBasemapEnabled } from '../features/maps/basemap-settings.js';
import { snapshotSchema } from '@fangyu/contracts';
import { HandbookSession } from '@fangyu/domain';
import VisitedMapLayers from '../components/VisitedMapLayers.vue';

const lib = vi.hoisted(() => {
  class MockMap {
    events: Record<string, (event?: unknown) => void> = {};
    source = {
      setData: vi.fn<(data: FeatureCollection) => void>(),
      updateData: vi.fn<(diff: unknown) => Promise<void>>(async () => {}),
      getClusterLeaves: vi.fn<() => Promise<Feature[]>>(async () => []),
    };
    sources = new Map<string, typeof this.source>();
    canvas = document.createElement('canvas');
    hasImage = () => true;
    addImage = vi.fn();
    setMissingStyleImageResolver = vi.fn();
    getLayer = (id: string) => ({ id });
    getStyle = () => ({ layers: [] });
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    setFeatureState = vi.fn();
    removeFeatureState = vi.fn();
    setFilter = vi.fn();
    fitBounds = vi.fn();
    jumpTo = vi.fn();
    easeTo = vi.fn();
    stop = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    queryRenderedFeatures = vi.fn<() => MapGeoJSONFeature[]>(() => []);
    getZoom = () => 12;
    project = () => ({ x: 0, y: 0 });
    zoomTo = vi.fn();
    getCenter = () => ({ toArray: () => [116.4, 39.9] });
    getCanvas = () => this.canvas;
    getSource = (id?: string) => {
      if (!id?.startsWith('china-options-')) return this.source;
      let source = this.sources.get(id);
      if (!source) {
        source = {
          setData: vi.fn<(data: FeatureCollection) => void>(),
          updateData: vi.fn<(diff: unknown) => Promise<void>>(async () => {}),
          getClusterLeaves: vi.fn<() => Promise<Feature[]>>(async () => []),
        };
        this.sources.set(id, source);
      }
      return source;
    };
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
const canvasView = vi.hoisted(() => ({
  camera: undefined as { center: [number, number]; zoom: number } | undefined,
  notify: () => {},
}));
vi.mock('@fangyu/map-renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fangyu/map-renderer')>()),
  CanvasMapRenderer: class {
    constructor(_host: unknown, _select: unknown, _hover: unknown, viewChanged: () => void) {
      canvasView.notify = viewChanged;
    }
    setScene = vi.fn(() => canvasView.notify());
    fit = vi.fn();
    destroy = vi.fn();
    camera = () => canvasView.camera;
    setCamera = vi.fn();
    stop = vi.fn();
    projectPoint = () => [0, 0];
  },
}));
import MapSurface from '../components/MapSurface.vue';
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(async () => {
  lib.maps = [];
  lib.fail = false;
  canvasView.camera = undefined;
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
  it('does not republish an unchanged canvas camera when parent updates redraw the scene', async () => {
    lib.fail = true;
    canvasView.camera = { center: [116.4, 39.9], zoom: 8 };
    wrapper = mount(MapSurface, { props: { scope: 'china', regionMode: true, points: [] } });
    await vi.dynamicImportSettled();
    await flushPromises();
    const store = useAppStore();
    const previous = store.regionalMap;
    await wrapper.setProps({ points: [] });
    expect(store.regionalMap).toBe(previous);
    await wrapper.setProps({ selected: beijing });
    expect(store.regionalMap!.selected).toBe(beijing);
    const selected = store.regionalMap;
    await wrapper.setProps({ points: [] });
    expect(store.regionalMap).toBe(selected);
  });
  it('animates regional selection from the current camera to the selected bounds', async () => {
    wrapper = mount(MapSurface, { props: { scope: 'china', regionMode: true, points: [] } });
    await vi.dynamicImportSettled();
    await flushPromises();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    map.fitBounds.mockClear();
    map.jumpTo.mockClear();
    await wrapper.setProps({ selected: beijing });
    expect(map.fitBounds).toHaveBeenCalledWith(
      manifest.scopes.china.regionBounds[beijing],
      expect.objectContaining({ duration: 650, padding: 45 }),
    );
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
  it('updates only changed feature state on the region matching its vector layer', async () => {
    const current = await open();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    map.setFeatureState.mockClear();
    const store = useAppStore();
    store.commit((session) => session.upgradeRegion(dongcheng, 'transit'));
    await flushPromises();
    expect(map.setFeatureState).toHaveBeenCalledTimes(3);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'county', sourceLayer: 'regions', id: dongcheng },
      { fill: expect.any(String), recorded: true },
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'city', sourceLayer: 'regions', id: city },
      { fill: expect.any(String), recorded: true },
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'province', sourceLayer: 'regions', id: beijing },
      { fill: expect.any(String), recorded: true },
    );
    expect(current.exists()).toBe(true);
  });
  it('updates only changed boundary features without reconfiguring unrelated map layers', async () => {
    const scope = manifest.scopes.china;
    const previousOptions = scope.boundaryOptions;
    const previousGroupCount = scope.boundaryOptionGroups;
    scope.boundaryOptions = 'maps/china-boundary-options.json.gz';
    scope.boundaryOptionGroups = 2;
    const polygon = (offset: number) => ({
      type: 'Polygon' as const,
      coordinates: [
        [
          [116 + offset, 39],
          [117 + offset, 39],
          [117 + offset, 40],
          [116 + offset, 40],
          [116 + offset, 39],
        ],
      ],
    });
    const boundaryData = {
      geometries: { before: polygon(0), after: polygon(0.1), stable: polygon(1) },
      groups: [
        {
          keys: ['shenshan'],
          regionIds: [dongcheng],
          variants: {
            '0': [
              {
                regionId: dongcheng,
                level: 'county',
                name: '东城区',
                geometry: 'before',
                bounds: [116, 39, 117, 40],
              },
            ],
            '1': [
              {
                regionId: dongcheng,
                level: 'county',
                name: '东城区',
                geometry: 'after',
                bounds: [116.1, 39, 117.1, 40],
              },
            ],
          },
        },
        {
          keys: ['lianjiang'],
          regionIds: [beijing],
          variants: {
            '0': [
              {
                regionId: beijing,
                level: 'province',
                name: '北京市',
                geometry: 'stable',
                bounds: [117, 39, 118, 40],
              },
            ],
            '1': [
              {
                regionId: beijing,
                level: 'province',
                name: '北京市',
                geometry: 'stable',
                bounds: [117, 39, 118, 40],
              },
            ],
          },
        },
      ],
      lineGroups: [],
    } satisfies ChinaBoundaryData;
    const store = useAppStore();
    store.chinaBoundaryData = boundaryData;
    try {
      const current = await open();
      const map = lib.maps[0]!;
      map.events['style.load']!();
      await flushPromises();
      map.source.setData.mockClear();
      map.sources.get('china-options-0')!.updateData.mockClear();
      map.sources.get('china-options-1')!.updateData.mockClear();
      map.sources.get('china-options-lines')!.setData.mockClear();
      map.setLayoutProperty.mockClear();
      map.setPaintProperty.mockClear();
      map.setFilter.mockClear();
      map.setFeatureState.mockClear();
      map.removeFeatureState.mockClear();
      store.commit((session) =>
        session.updatePreferences({
          chinaBoundaries: { ...store.chinaBoundarySettings, shenshan: false },
        }),
      );
      await flushPromises();
      expect(map.sources.get('china-options-0')!.updateData).toHaveBeenCalledOnce();
      expect(map.sources.get('china-options-0')!.updateData.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          update: [
            expect.objectContaining({ id: dongcheng, newGeometry: boundaryData.geometries.before }),
          ],
        }),
      );
      expect(map.source.setData).not.toHaveBeenCalled();
      expect(map.sources.get('china-options-1')!.updateData).not.toHaveBeenCalled();
      expect(map.sources.get('china-options-lines')!.setData).not.toHaveBeenCalled();
      expect(map.setLayoutProperty).not.toHaveBeenCalled();
      expect(map.setPaintProperty).not.toHaveBeenCalled();
      expect(map.setFilter).not.toHaveBeenCalled();
      expect(
        map.setFeatureState.mock.calls.every(([target]) => target.source === 'china-options-0'),
      ).toBe(true);
      expect(map.removeFeatureState).not.toHaveBeenCalled();
      expect(current.exists()).toBe(true);
    } finally {
      store.chinaBoundaryData = undefined;
      if (previousOptions === undefined) delete scope.boundaryOptions;
      else scope.boundaryOptions = previousOptions;
      if (previousGroupCount === undefined) delete scope.boundaryOptionGroups;
      else scope.boundaryOptionGroups = previousGroupCount;
    }
  });
  it('persists disabled automatic focus and keeps selection and layer changes from moving the camera', async () => {
    wrapper = mount(MapSurface, { props: { scope: 'china', regionMode: true, points: [] } });
    await vi.dynamicImportSettled();
    await flushPromises();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    const toggle = wrapper.find('[aria-label="选区自动缩放"]');
    expect((toggle.element as HTMLInputElement).checked).toBe(true);
    await toggle.setValue(false);
    const store = useAppStore();
    await store.flush();
    const restored = new HandbookSession(
      store.session!.index,
      snapshotSchema.parse(store.session!.snapshot()),
    );
    expect(restored.preferences.regionAutoFocus).toBe(false);
    expect(map.stop).toHaveBeenCalledOnce();
    map.fitBounds.mockClear();
    map.jumpTo.mockClear();
    await wrapper.setProps({ selected: beijing, level: 'province' });
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'province', sourceLayer: 'regions', id: beijing },
      expect.objectContaining({ selected: true }),
    );
    expect(store.regionalMap!.selected).toBe(beijing);
    await wrapper
      .findAll('.region-map-tools-body button')
      .find((button) => button.text() === '定位当前地区')!
      .trigger('click');
    expect(map.fitBounds).toHaveBeenCalledOnce();
    map.fitBounds.mockClear();
    await toggle.setValue(true);
    expect(map.fitBounds).not.toHaveBeenCalled();
    await wrapper.setProps({ selected: '' });
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });
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
  it('ignores a whole city face in county mode and selects the underlying county', async () => {
    wrapper = mount(MapSurface, {
      props: { scope: 'china', level: 'county', regionMode: true, points: [] },
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    const map = lib.maps[0]!;
    map.events['style.load']!();
    const faces = [city, dongcheng].map((id) => ({
      properties: { regionId: id },
      layer: { id: 'county-fill' },
      geometry: { type: 'Polygon', coordinates: [] },
    })) as unknown as MapGeoJSONFeature[];
    map.queryRenderedFeatures.mockImplementation((...args: unknown[]) =>
      (args[1] as { layers: string[] }).layers.includes('county-fill') ? faces : [],
    );
    map.events.click!({ point: { x: 10, y: 10 }, lngLat: { lng: 116.4, lat: 39.9 } });
    expect(wrapper.emitted('select')).toEqual([[dongcheng]]);
  });

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
