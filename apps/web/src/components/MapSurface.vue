<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, onActivated, ref, watch } from 'vue';
import {
  Map as LibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Scope } from '@fangyu/contracts';
import { VISIT_LABELS } from '@fangyu/contracts';
import type { EntryView } from '@fangyu/domain';
import { CanvasMapRenderer, type MapScene } from '@fangyu/map-renderer';
import type { Bounds, MapViewState } from '../app/workspace.js';
import { useAppStore } from '../app/store.js';
import { tianditu, type MapDataManifest } from '../features/maps/types.js';
import { createMapStyle } from '../features/maps/style.js';
import { categoryIcon } from '../features/catalog/categories.js';
setWorkerUrl(workerUrl);
const props = defineProps<{
  scope: Scope;
  state: MapViewState;
  selected: string;
  focused: string;
  points: EntryView[];
}>();
const emit = defineEmits<{
  select: [id: string];
  point: [id: string];
  candidates: [ids: string[]];
  camera: [camera: NonNullable<MapViewState['camera']>];
  bounds: [bounds: Bounds];
  search: [bounds: Bounds];
}>();
const store = useAppStore();
const host = ref<HTMLElement>(),
  loading = ref(true),
  error = ref(''),
  fallback = ref(false),
  hover = ref('');
let map: LibreMap | undefined,
  canvas: CanvasMapRenderer | undefined,
  manifest: MapDataManifest | undefined;
let simple: GeoJSON.FeatureCollection | undefined;
let generation = 0,
  loaded = false;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFit: string | null = null;
let resizeObserver: ResizeObserver | undefined;
let hoveredRegion = '';
const base = import.meta.env.BASE_URL;
const provider = tianditu(import.meta.env.VITE_TIANDITU_KEY || '');
const providerFailed = ref(false);
const selectedCategory = computed(
  () =>
    store.session!.index.catalog.categories.find((c) => c.id === props.state.colorCategory)?.name,
);
const legend = computed(() =>
  props.state.colorCategory
    ? [
        { label: '未标记 ' + selectedCategory.value, color: store.colors.unvisited },
        { label: '已标记 ' + selectedCategory.value, color: store.colors.arrived },
      ]
    : Object.entries(VISIT_LABELS).map(([state, label]) => ({
        label,
        color: store.colors[state as keyof typeof VISIT_LABELS],
      })),
);
const categoryRegions = computed(() => {
  void store.revision;
  const ids = new Set<string>();
  if (props.state.colorCategory)
    for (const e of store.rows)
      if (e.categoryId === props.state.colorCategory && e.visited)
        for (const owner of store.session!.index.entryRegions(e, props.scope))
          for (const r of store.session!.index.ancestors(owner)) ids.add(r.id);
  return ids;
});
function fill(id: string) {
  const r = store.session!.index.regions.get(id);
  return r
    ? store.colors[
        props.state.colorCategory
          ? categoryRegions.value.has(id)
            ? 'arrived'
            : 'unvisited'
          : store.session!.visitState(id)
      ]
    : store.colors.unmapped;
}
function isSelected(id: string) {
  return !!props.selected && store.session!.index.belongsTo(id, props.selected);
}
function scene(): MapScene {
  return {
    world: props.scope === 'world',
    dark: store.dark,
    features: (simple?.features || [])
      .filter((f) => f.properties?.level === props.state.level || f.properties?.level === 'border')
      .map((f) => ({
        id: String(f.properties?.regionId),
        name: String(f.properties?.name || ''),
        geometry: f.geometry,
        fill:
          f.properties?.level === 'border' ? 'transparent' : fill(String(f.properties?.regionId)),
        selected: isSelected(String(f.properties?.regionId)),
        interactive: !!store.session!.index.regions.get(String(f.properties?.regionId)),
      })),
    points: props.state.showPoints
      ? props.points
          .filter((e) => e.coordinates)
          .map((e) => ({ id: e.id, name: e.name, coords: e.coordinates!, marked: e.visited }))
      : [],
  };
}
async function loadSimple() {
  if (!simple) {
    const response = await fetch(base + manifest!.scopes[props.scope].simplified, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('简化边界加载失败');
    return (await response.json()) as GeoJSON.FeatureCollection;
  }
  return simple!;
}
async function useFallback(token: number) {
  clearTimeout(loadTimer);
  try {
    const geometry = await loadSimple();
    if (token !== generation || !host.value) return;
    simple = geometry;
    map?.remove();
    map = undefined;
    loaded = false;
    fallback.value = true;
    host.value.replaceChildren();
    canvas = new CanvasMapRenderer(
      host.value,
      (id, point) => {
        if (!point) {
          emit('select', id);
          return;
        }
        const chosen = props.points.find((p) => p.id === id);
        const overlaps = props.points.filter(
          (p) =>
            p.coordinates &&
            chosen?.coordinates &&
            Math.hypot(
              p.coordinates[0] - chosen.coordinates[0],
              p.coordinates[1] - chosen.coordinates[1],
            ) < 0.00001,
        );
        if (overlaps.length > 1)
          emit(
            'candidates',
            overlaps.map((p) => p.id),
          );
        else emit('point', id);
      },
      (name) => (hover.value = name),
    );
    canvas.setScene(scene(), true);
    if (pendingFit !== null) {
      fitRegion(pendingFit);
      pendingFit = null;
    }
  } catch (cause) {
    error.value = String(cause);
  } finally {
    loading.value = false;
  }
}
function data(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.state.showPoints
      ? props.points
          .filter((e) => e.coordinates)
          .map((e) => ({
            type: 'Feature',
            id: e.id,
            geometry: { type: 'Point', coordinates: e.coordinates! },
            properties: {
              id: e.id,
              name: e.name,
              category: e.categoryId,
              marked: e.visited,
              icon: e.categoryId + (e.visited ? '-marked' : '-blank'),
            },
          }))
      : [],
  };
}
const featureColors = new globalThis.Map<string, string>();
function updateAppearance() {
  if (canvas) {
    canvas.setScene(scene());
    return;
  }
  if (!map || !loaded) return;
  const layers = manifest!.scopes[props.scope].layers;
  for (const l of layers) {
    const show = l.level === props.state.level || l.level === 'border';
    for (const suffix of ['fill', 'line'])
      if (map.getLayer(l.level + '-' + suffix))
        map.setLayoutProperty(l.level + '-' + suffix, 'visibility', show ? 'visible' : 'none');
    if (l.level !== 'border')
      map.setPaintProperty(
        l.level + '-fill',
        'fill-opacity',
        props.state.preset === 'footprints' ? 0.86 : 0.27,
      );
  }
  for (const r of store.session!.index.catalog.regions.filter((r) => r.scope === props.scope)) {
    const color = fill(r.id),
      key = color + ':' + isSelected(r.id);
    if (featureColors.get(r.id) === key) continue;
    featureColors.set(r.id, key);
    for (const layer of layers)
      map.setFeatureState(
        { source: layer.level, sourceLayer: 'regions', id: r.id },
        { fill: color, selected: isSelected(r.id) },
      );
  }
  if (map.getLayer('background'))
    map.setPaintProperty('background', 'background-color', store.dark ? '#1c2c32' : '#eaf0ed');
  for (const name of ['basemap', 'labels'])
    if (map.getLayer(name))
      map.setPaintProperty(
        name,
        'raster-opacity',
        props.state.preset === 'footprints' ? (name === 'labels' ? 0.3 : 0.18) : 1,
      );
  if (map.getLayer('selected-point'))
    map.setFilter('selected-point', ['==', ['get', 'id'], props.focused]);
}
function drawIcon(category: string, marked: boolean) {
  const image = document.createElement('canvas');
  image.width = 52;
  image.height = 52;
  const c = image.getContext('2d')!;
  c.beginPath();
  c.arc(26, 26, 22, 0, Math.PI * 2);
  c.fillStyle = marked ? '#287560' : '#fffdf7';
  c.fill();
  c.strokeStyle = marked ? '#fffdf7' : '#55796c';
  c.lineWidth = 3;
  c.stroke();
  c.font = 'bold 24px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = marked ? '#fff' : '#385a4e';
  c.fillText(categoryIcon(category), 26, 27);
  return c.getImageData(0, 0, 52, 52);
}
function publishBounds() {
  if (!map) return;
  const b = map.getBounds();
  const bounds: Bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  emit('bounds', bounds);
  const c = map.getCenter();
  emit('camera', { center: [c.lng, c.lat], zoom: map.getZoom() });
}
async function initialize() {
  clearTimeout(loadTimer);
  const token = ++generation;
  loading.value = true;
  error.value = '';
  fallback.value = false;
  providerFailed.value = false;
  loaded = false;
  simple = undefined;
  featureColors.clear();
  map?.remove();
  canvas?.destroy();
  map = undefined;
  canvas = undefined;
  try {
    const response = await fetch(base + 'map-manifest.json', {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('地图资源索引加载失败');
    manifest = await response.json();
    if (token !== generation || !host.value) return;
    const camera = props.state.camera;
    map = new LibreMap({
      container: host.value,
      style: createMapStyle(manifest!, props.scope, props.focused, provider, base, location.href),
      center: camera?.center || [105, 35],
      zoom: camera?.zoom ?? 3,
      attributionControl: { compact: true },
      localIdeographFontFamily: 'Microsoft YaHei, sans-serif',
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    loadTimer = setTimeout(() => {
      if (token !== generation || loaded) return;
      error.value = '地图加载超时，已尝试切换简化地图。';
      void useFallback(token);
    }, 15000);
    map.on('error', (e) => {
      if (token !== generation) return;
      if ((e as any).sourceId === 'basemap' || (e as any).sourceId === 'labels') {
        providerFailed.value = true;
        for (const id of ['basemap', 'labels'])
          if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      } else if (!loaded) error.value = '地图资源暂时无法完整加载，可切换简化地图。';
    });
    map.on('load', () => {
      if (token !== generation || !map) return;
      clearTimeout(loadTimer);
      for (const c of store.session!.index.catalog.categories)
        for (const marked of [true, false])
          map.addImage(c.id + (marked ? '-marked' : '-blank'), drawIcon(c.id, marked), {
            pixelRatio: 2,
          });
      loaded = true;
      loading.value = false;
      (map.getSource('points') as GeoJSONSource).setData(data());
      updateAppearance();
      if (pendingFit !== null) {
        fitRegion(pendingFit);
        pendingFit = null;
      } else if (!camera)
        map.fitBounds(manifest!.scopes[props.scope].bounds, { padding: 45, duration: 0 });
      publishBounds();
    });
    map.on('moveend', publishBounds);
    map.on('click', async (e) => {
      if (!map || !loaded) return;
      const clusters = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      if (clusters.length) {
        const f = clusters[0]!,
          source = map.getSource('points') as GeoJSONSource;
        const activeMap = map;
        try {
          const zoom = await source.getClusterExpansionZoom(Number(f.properties.cluster_id));
          if (map !== activeMap) return;
          map.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          });
        } catch {
          hover.value = '点位已更新，请重新选择。';
        }
        return;
      }
      const points = map.queryRenderedFeatures(
        [
          [e.point.x - 10, e.point.y - 10],
          [e.point.x + 10, e.point.y + 10],
        ],
        { layers: ['points', 'point-labels'] },
      );
      const ids = [...new Set(points.map((f) => String(f.properties.id)))];
      // Collision-hidden symbols must remain reachable at the same location.
      if (ids.length && map.getZoom() > 14 && props.state.showPoints) {
        const anchors = props.points
          .filter((p) => ids.includes(p.id) && p.coordinates)
          .map((p) => map!.project(p.coordinates!));
        for (const p of props.points) {
          if (!p.coordinates || ids.includes(p.id)) continue;
          const xy = map.project(p.coordinates);
          if (anchors.some((a) => Math.hypot(a.x - xy.x, a.y - xy.y) < 18)) ids.push(p.id);
        }
      }
      if (ids.length > 1) emit('candidates', ids);
      else if (ids.length) emit('point', ids[0]!);
      else {
        const region = map
          .queryRenderedFeatures(e.point, { layers: [props.state.level + '-fill'] })
          .find((f) => store.session!.index.regions.has(String(f.properties.regionId)));
        if (region) emit('select', String(region.properties.regionId));
      }
    });
    map.on('mousemove', (e) => {
      if (!map || !loaded) return;
      const f = map
        .queryRenderedFeatures(e.point)
        .find((f: MapGeoJSONFeature) => f.properties.name);
      hover.value = String(f?.properties.name || '');
      const id = String(f?.properties.regionId || '');
      if (id !== hoveredRegion) {
        for (const layer of manifest!.scopes[props.scope].layers) {
          if (hoveredRegion)
            map.setFeatureState(
              { source: layer.level, sourceLayer: 'regions', id: hoveredRegion },
              { hover: false },
            );
          if (id)
            map.setFeatureState(
              { source: layer.level, sourceLayer: 'regions', id },
              { hover: true },
            );
        }
        hoveredRegion = id;
      }
      map.getCanvas().style.cursor = f ? 'pointer' : '';
    });
  } catch (cause) {
    if (token !== generation) return;
    if (manifest) await useFallback(token);
    else {
      error.value = '地图资源无法载入：' + String(cause);
      loading.value = false;
    }
  }
}
function fitRegion(id?: string) {
  if (!canvas && (!map || !loaded)) {
    pendingFit = id || '';
    return;
  }
  const bounds = id
    ? manifest?.scopes[props.scope].regionBounds[id]
    : manifest?.scopes[props.scope].bounds;
  if (map && bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 450 });
  if (canvas)
    canvas.fit(
      id
        ? scene()
            .features.filter((f) => store.session!.index.belongsTo(f.id, id))
            .map((f) => f.id)
        : undefined,
    );
}
function fitPoints() {
  if (!map) {
    canvas?.fit();
    return;
  }
  const points = props.points.filter((e) => e.coordinates);
  if (!points.length) return;
  const bounds = points.reduce<Bounds>(
    (b, e) => [
      Math.min(b[0], e.coordinates![0]),
      Math.min(b[1], e.coordinates![1]),
      Math.max(b[2], e.coordinates![0]),
      Math.max(b[3], e.coordinates![1]),
    ],
    [180, 85, -180, -85],
  );
  map.fitBounds(bounds, { padding: 55, maxZoom: 12 });
}
function locate(id: string) {
  const p = props.points.find((e) => e.id === id) || store.rows.find((e) => e.id === id);
  if (map && p?.coordinates)
    map.easeTo({ center: p.coordinates, zoom: Math.max(11, map.getZoom()) });
  else if (canvas && p?.coordinates) canvas.locate(p.coordinates);
}
function searchArea() {
  if (map) {
    const b = map.getBounds();
    emit('search', [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }
}
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (host.value?.clientWidth && host.value?.clientHeight) map?.resize();
  });
  if (host.value) resizeObserver.observe(host.value);
  void initialize();
});
onActivated(() => map?.resize());
onBeforeUnmount(() => {
  generation++;
  resizeObserver?.disconnect();
  clearTimeout(loadTimer);
  map?.remove();
  canvas?.destroy();
});
watch(() => props.scope, initialize);
watch(
  () => [
    store.revision,
    store.dark,
    props.selected,
    props.focused,
    props.state.level,
    props.state.preset,
    props.state.colorCategory,
  ],
  updateAppearance,
);
watch(
  () => [props.points, props.state.showPoints],
  () => {
    if (canvas) canvas.setScene(scene());
    if (map && loaded) (map.getSource('points') as GeoJSONSource).setData(data());
  },
);
defineExpose({ fitRegion, fitPoints, locate });
</script>
<template>
  <section class="map-surface-frame">
    <div
      ref="host"
      class="map-surface"
    />
    <div class="map-top-tools">
      <button @click="fitRegion()">全图</button
      ><button
        :disabled="!selected"
        @click="fitRegion(selected)"
      >
        所选地区</button
      ><button
        @click="fitPoints"
        :disabled="!points.some((e) => e.coordinates)"
      >
        全部点位</button
      ><button
        v-if="!fallback"
        @click="searchArea"
      >
        搜索此区域
      </button>
    </div>
    <div
      v-if="loading"
      class="map-loading"
      role="status"
    >
      正在准备地图…
    </div>
    <div
      v-if="!provider || providerFailed || fallback || error"
      class="map-provider-note"
      role="status"
    >
      {{
        error ||
        (fallback
          ? '当前使用简化地图，仍可查看和记录到访。'
          : providerFailed
            ? '在线底图不可用，已保留边界与项目。'
            : '简化底图 · 配置天地图密钥后可显示道路与地名')
      }}<button
        v-if="error && !fallback && manifest"
        @click="useFallback(generation)"
      >
        使用简化地图
      </button>
      <button
        v-if="error || providerFailed || fallback"
        :disabled="loading"
        @click="initialize"
      >
        重试地图
      </button>
    </div>
    <div class="map-legend">
      <strong>{{ state.colorCategory ? '专题到访分布' : '地区旅行状态' }}</strong
      ><span
        v-for="item in legend"
        :key="item.label"
        ><i :style="{ background: item.color }" />{{ item.label }}</span
      ><small>{{ hover || '拖动浏览 · 点击查看 · 聚合数字为有坐标的目录条目数' }}</small>
    </div>
  </section>
</template>
