<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Marker, type Map as MapInstance, type Point } from 'maplibre-gl';
import PointIcon from './PointIcon.vue';
import { basemapProvider } from '../features/maps/basemap-settings.js';
import { createMapStyle } from '../features/maps/style.js';
import { LibreMap } from '../features/maps/tile-runtime.js';
import type { MapDataManifest } from '../features/maps/types.js';

const props = withDefaults(
  defineProps<{
    coordinates?: [number, number] | null;
    highlightRegionIds?: string[];
    readonly?: boolean;
    focusKey?: string;
  }>(),
  { coordinates: null, highlightRegionIds: () => [], readonly: false, focusKey: '' },
);
const emit = defineEmits<{
  pick: [coordinates: [number, number], regionIds: string[]];
  clear: [];
}>();
const host = ref<HTMLElement>();
const loading = ref(true);
const error = ref('');
const map = shallowRef<MapInstance>();
let marker: Marker | undefined;
let observer: ResizeObserver | undefined;
let china: MapDataManifest['scopes']['china'] | undefined;

function candidateIds(point: Point) {
  const current = map.value;
  if (!current) return [];
  const layers = ['admin-county-hit', 'admin-city-hit', 'admin-province-hit'].filter((id) =>
    current.getLayer(id),
  );
  if (!layers.length) return [];
  const order = new Map(layers.map((id, index) => [id, index]));
  return [
    ...new Set(
      current
        .queryRenderedFeatures(point, { layers })
        .sort((a, b) => (order.get(a.layer.id) ?? 99) - (order.get(b.layer.id) ?? 99))
        .map((feature) => String(feature.properties?.regionId || ''))
        .filter(Boolean),
    ),
  ];
}
function highlight() {
  const current = map.value;
  if (!current?.isStyleLoaded()) return;
  for (const level of ['county', 'city', 'province'])
    if (current.getLayer(`admin-${level}-highlight`))
      current.setFilter(`admin-${level}-highlight`, [
        'in',
        ['get', 'regionId'],
        ['literal', props.highlightRegionIds],
      ] as never);
}
function syncMarker() {
  const current = map.value;
  if (!current) return;
  if (!props.coordinates) {
    marker?.remove();
    marker = undefined;
    return;
  }
  if (!marker) {
    marker = new Marker({ color: '#ad7650', draggable: !props.readonly })
      .setLngLat(props.coordinates)
      .addTo(current);
    marker.on('dragend', () => {
      if (!marker || !map.value || props.readonly) return;
      const p = marker.getLngLat();
      emit(
        'pick',
        [Number(p.lng.toFixed(7)), Number(p.lat.toFixed(7))],
        candidateIds(map.value.project(p)),
      );
    });
  }
  marker.setLngLat(props.coordinates).setDraggable(!props.readonly);
}
function focusPoint() {
  const current = map.value;
  if (!current) return;
  if (props.coordinates) {
    current.flyTo({
      center: props.coordinates,
      zoom: Math.max(12, current.getZoom()),
      duration: 450,
    });
    return;
  }
  const bounds = props.highlightRegionIds.map((id) => china?.regionBounds[id]).find(Boolean);
  if (bounds) current.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 450 });
}
function overview() {
  if (china) map.value?.fitBounds(china.bounds, { padding: 40, duration: 450 });
}
async function initialize() {
  if (!host.value) return;
  try {
    const base = import.meta.env.BASE_URL;
    const response = await fetch(base + 'map-manifest.json');
    if (!response.ok) throw Error('地图资源不可用');
    const manifest = (await response.json()) as MapDataManifest;
    china = manifest.scopes.china;
    if (!china) throw Error('地图资源不可用');
    const current = new LibreMap({
      container: host.value,
      style: createMapStyle(
        manifest,
        'china',
        'county',
        basemapProvider.value,
        base,
        location.href,
      ),
      bounds: china.bounds,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      renderWorldCopies: false,
      maxZoom: 19,
      dragRotate: false,
      touchPitch: false,
    });
    map.value = current;
    current.on('load', () => {
      for (const level of ['county', 'city', 'province']) {
        if (!current.getLayer(`${level}-fill`)) continue;
        current.addLayer({
          id: `admin-${level}-highlight`,
          type: 'fill',
          source: level,
          'source-layer': 'regions',
          filter: ['in', ['get', 'regionId'], ['literal', []]],
          paint: { 'fill-color': '#b78d54', 'fill-opacity': 0.18 },
        });
        current.addLayer({
          id: `admin-${level}-hit`,
          type: 'fill',
          source: level,
          'source-layer': 'regions',
          filter: ['has', 'regionId'],
          paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.001 },
        });
      }
      current.on('click', (event) => {
        if (!props.readonly)
          emit(
            'pick',
            [Number(event.lngLat.lng.toFixed(7)), Number(event.lngLat.lat.toFixed(7))],
            candidateIds(event.point),
          );
      });
      syncMarker();
      highlight();
      focusPoint();
      loading.value = false;
      error.value = '';
    });
    current.on('error', () => {
      if (!current.isStyleLoaded()) {
        error.value = '地图加载失败';
        loading.value = false;
      }
    });
  } catch (cause) {
    error.value = String(cause).replace(/^Error:\s*/, '');
    loading.value = false;
  }
}
watch(() => props.coordinates, syncMarker, { deep: true });
watch(() => props.readonly, syncMarker);
watch(() => props.highlightRegionIds, highlight, { deep: true });
watch(() => props.focusKey, focusPoint);
onMounted(() => {
  observer = new ResizeObserver(() => map.value?.resize());
  if (host.value) observer.observe(host.value);
  void initialize();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  marker?.remove();
  map.value?.remove();
  marker = undefined;
  map.value = undefined;
});
</script>

<template>
  <div
    class="admin-map-editor"
    :class="{ 'admin-map-readonly': readonly }"
  >
    <div
      ref="host"
      class="admin-map-canvas"
      :aria-busy="loading"
    />
    <div
      v-if="loading || error"
      class="admin-map-status"
      :class="{ 'admin-map-error': error }"
      role="status"
    >
      <span
        v-if="loading && !error"
        class="admin-map-spinner"
        aria-label="载入地图"
      /><template v-else>{{ error }}</template>
    </div>
    <div class="admin-map-controls">
      <div class="admin-map-control-group">
        <button
          type="button"
          title="放大"
          aria-label="放大"
          :disabled="loading"
          @click="map?.zoomIn()"
        >
          <PointIcon
            name="plus"
            :size="18"
          /></button
        ><button
          type="button"
          title="缩小"
          aria-label="缩小"
          :disabled="loading"
          @click="map?.zoomOut()"
        >
          <PointIcon
            name="minus"
            :size="18"
          />
        </button>
      </div>
      <div class="admin-map-control-group">
        <button
          type="button"
          title="全图"
          aria-label="全图"
          :disabled="loading"
          @click="overview"
        >
          <PointIcon
            name="frame"
            :size="17"
          /></button
        ><button
          v-if="coordinates"
          type="button"
          title="当前点位"
          aria-label="当前点位"
          @click="focusPoint"
        >
          <PointIcon
            name="location"
            :size="17"
          />
        </button>
      </div>
    </div>
    <div
      v-if="coordinates"
      class="admin-map-coordinates"
    >
      <PointIcon
        name="location"
        :size="14"
      /><span>{{ coordinates[0].toFixed(6) }}, {{ coordinates[1].toFixed(6) }}</span>
    </div>
  </div>
</template>

<style scoped>
.admin-map-editor {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--atlas-soft);
}
.admin-map-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.admin-map-editor:not(.admin-map-readonly)
  :deep(.maplibregl-canvas-container.maplibregl-interactive) {
  cursor: crosshair;
}
.admin-map-editor :deep(.maplibregl-marker) {
  cursor: grab;
}
.admin-map-editor :deep(.maplibregl-marker:active) {
  cursor: grabbing;
}
.admin-map-status {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 8px 11px;
  border: 1px solid var(--atlas-line);
  border-radius: 7px;
  background: var(--atlas-paper);
  color: var(--atlas-ink);
  font-size: 12px;
}
.admin-map-error {
  color: #ae5143;
}
.admin-map-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--atlas-line);
  border-top-color: var(--atlas-accent);
  border-radius: 50%;
  animation: map-spin 0.8s linear infinite;
}
.admin-map-controls {
  position: absolute;
  top: 18px;
  right: 18px;
  display: grid;
  gap: 10px;
}
.admin-map-control-group {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--atlas-line);
  border-radius: 7px;
  background: var(--atlas-paper);
  box-shadow: 0 2px 8px rgb(20 35 24 / 5%);
}
.admin-map-control-group button {
  display: grid;
  place-items: center;
  width: 34px;
  min-height: 34px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--atlas-ink);
  cursor: pointer;
}
.admin-map-control-group button + button {
  border-top: 1px solid var(--atlas-line);
}
.admin-map-control-group button:hover {
  background: var(--atlas-soft);
}
.admin-map-control-group button:focus-visible {
  outline: 2px solid var(--atlas-accent);
  outline-offset: -3px;
}
.admin-map-control-group button:disabled {
  opacity: 0.4;
  cursor: default;
}
.admin-map-coordinates {
  position: absolute;
  bottom: 22px;
  left: 18px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid var(--atlas-line);
  border-radius: 6px;
  background: var(--atlas-paper);
  color: var(--atlas-ink);
  font:
    11px/1.5 Consolas,
    monospace;
  font-variant-numeric: tabular-nums;
}
.admin-map-coordinates svg {
  color: #ad7650;
}
@keyframes map-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 640px) {
  .admin-map-controls {
    top: 12px;
    right: 12px;
    gap: 7px;
  }
  .admin-map-control-group button {
    width: 30px;
    min-height: 30px;
  }
  .admin-map-coordinates {
    left: 12px;
    bottom: 16px;
    padding: 5px 8px;
    font-size: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .admin-map-spinner {
    animation: none;
  }
}
</style>
