import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Map as LibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { VISIT_LABELS, getScopeConfig, type Scope, type MapLevel } from '@fangyu/contracts';
import {
  visitedMapMarkers,
  type EntryView,
  type VisitedMapMarker,
  type VerifiedVisitedMapAssociation,
} from '@fangyu/domain';
import {
  CanvasMapRenderer,
  drawVisitedMarker,
  drawVisitedCluster,
  type MapScene,
  type MapHover,
  type VisitedMarkerKind,
} from '@fangyu/map-renderer';
import { useAppStore } from '../../app/store.js';
import { download } from '../exports/download.js';
import { type Bounds, type MapDataManifest } from './types.js';
import { basemapProvider } from './basemap-settings.js';
import { mapAttributions } from './data-attribution.js';
import { boundaryFillOpacity, createMapStyle, VISITED_MARKER_LAYER_IDS } from './style.js';
import { regionInteractionPolicy } from './sea-region-interaction.js';
import airportAssociations from '../../../../../data/extensions/research/china-airport-map-associations.json';

setWorkerUrl(workerUrl);
export interface TiledMapProps {
  scope: Scope;
  selected: string;
  level: MapLevel;
  category: string;
  points?: EntryView[] | undefined;
  focus?: [number, number] | null | undefined;
}

export function useTiledMap(props: TiledMapProps, select: (id: string, point: boolean) => void) {
  const store = useAppStore();
  const host = ref<HTMLElement>(),
    mapHost = ref<HTMLElement>();
  const hovered = ref<MapHover>();
  const mapError = ref(''),
    loading = ref(true),
    fallback = ref(false),
    providerFailed = ref(false),
    missingBoundary = ref(false);
  const showPoints = ref(true);
  const mapZoom = ref(0);
  const mapCenter = ref<[number, number] | null>(null);
  const visitedLayers = computed(() => {
    void store.revision;
    return (
      store.session!.preferences.mapLayers || {
        visitedAirports: false,
        visitedWorldHeritage: false,
      }
    );
  });
  const visitedResult = computed(() => {
    void store.revision;
    return visitedMapMarkers(store.session!, {
      scope: props.scope,
      selectedRegionId: props.selected,
      layers: visitedLayers.value,
      associations: airportAssociations.associations as VerifiedVisitedMapAssociation[],
    });
  });
  const visitedById = computed(
    () => new Map(visitedResult.value.markers.map((marker) => [marker.id, marker])),
  );
  const selectedVisitedIds = ref<string[]>([]);
  const selectedVisitedMarkers = computed(() =>
    selectedVisitedIds.value
      .map((id) => visitedById.value.get(id))
      .filter((marker): marker is VisitedMapMarker => Boolean(marker)),
  );
  const base = import.meta.env.BASE_URL;
  const provider = basemapProvider;
  let map: LibreMap | undefined, canvas: CanvasMapRenderer | undefined;
  let manifest: MapDataManifest | undefined, simple: GeoJSON.FeatureCollection | undefined;
  let generation = 0,
    ready = false,
    fallingBack = false;
  let observer: ResizeObserver | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  type Camera = { center: [number, number]; zoom: number };
  let pendingProviderCamera: Camera | undefined;
  let lastVisitedResult: typeof visitedResult.value | undefined;
  let visitedSelectionRequest = 0;
  const level = computed(() =>
    props.scope === 'china' || props.scope === 'france'
      ? props.level
      : manifest?.scopes[props.scope]?.layers.find((l) => l.level !== 'border')?.level ||
        getScopeConfig(props.scope).defaultLevel,
  );
  const visiblePoints = computed(() =>
    showPoints.value
      ? (props.points || []).filter(
          (e) =>
            validCoordinates(e.coordinates) &&
            !visitedById.value.has(e.recordId) &&
            !e.coordinateStatus?.includes('representative') &&
            (e.visited || mapZoom.value >= 7 || props.category || props.selected || props.focus),
        )
      : [],
  );
  function validCoordinates(value: unknown): value is [number, number] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      Math.abs(value[0]) <= 180 &&
      Math.abs(value[1]) <= 90
    );
  }
  const visiblePointCount = computed(() => visiblePoints.value.length);
  const categoryRegions = computed(() => {
    void store.revision;
    const ids = new Set<string>();
    if (props.category && props.scope === 'china')
      for (const entry of store.rows) {
        if (entry.categoryId !== props.category || !entry.visited) continue;
        for (const id of entry.regionIds)
          for (const r of store.session!.index.ancestors(id)) ids.add(r.id);
      }
    return ids;
  });
  function fill(id: string) {
    const region = store.session!.index.regions.get(id);
    return region
      ? store.colors[
          props.category && props.scope === 'china'
            ? categoryRegions.value.has(id)
              ? 'arrived'
              : 'unvisited'
            : store.session!.visitState(id)
        ]
      : store.colors.unmapped;
  }
  const selected = (id: string) =>
    Boolean(props.selected && store.session!.index.belongsTo(id, props.selected));
  const hoverInfo = computed(() => {
    const hit = hovered.value;
    if (!hit) return;
    if ((hit.markerCount || 0) > 1)
      return {
        title: `${hit.markerCount} 个已到访地点`,
        detail: '点击查看成员列表；可继续选择单个地点。',
        state: '到访标记聚合',
      };
    if (hit.markerIds?.length) {
      const marker = visitedById.value.get(hit.markerIds[0]!);
      if (!marker) return;
      return {
        title: marker.name,
        detail:
          marker.kind === 'airport'
            ? '已到访机场'
            : marker.kind === 'project-reference'
              ? '世遗项目代表位置，不表示组成地点全部到访。'
              : '已到访世界遗产地点',
        state: marker.partial ? '部分子项已到访' : '已到访',
      };
    }
    if (hit.point) {
      const e = (props.points || []).find((e) => e.id === hit.id);
      if (!e) return;
      return {
        title: e.name,
        detail: `${store.session!.index.catalog.categories.find((c) => c.id === e.categoryId)?.name || '内容项目'} · ${e.path}`,
        state: e.visited ? '已标记' : '未标记',
      };
    }
    const r = store.session!.index.regions.get(hit.id);
    return r
      ? {
          title: r.name,
          detail:
            props.scope === 'world'
              ? r.aliases[0] || ''
              : store.session!.index.paths.get(r.id) || '',
          state: VISIT_LABELS[store.session!.visitState(r.id)],
        }
      : undefined;
  });
  const hoverStyle = computed(() => ({
    left: `${Math.max(8, Math.min((host.value?.clientWidth || 800) - 270, (hovered.value?.x || 0) + 16))}px`,
    top: `${Math.max(8, Math.min((host.value?.clientHeight || 560) - 100, (hovered.value?.y || 0) + 16))}px`,
  }));
  function scene(): MapScene {
    return {
      world: props.scope === 'world',
      dark: store.dark,
      allowsRegionHit: regionInteractionPolicy(props.scope),
      detailLevel: props.scope === 'china' && props.level !== 'country' ? props.level : undefined,
      features: (simple?.features || [])
        .filter((f) => f.properties?.level === level.value || f.properties?.level === 'border')
        .map((f) => {
          const id = String(f.properties?.regionId || f.id);
          return {
            id,
            name: String(f.properties?.name || ''),
            geometry: f.geometry,
            fill: f.properties?.level === 'border' ? 'transparent' : fill(id),
            selected: selected(id),
            interactive: store.session!.index.regions.has(id),
          };
        }),
      points: [
        ...visiblePoints.value.map((e) => ({
          id: e.id,
          name: e.name,
          coords: e.coordinates!,
          marked: e.visited,
        })),
        ...visitedResult.value.markers.map((marker) => ({
          id: marker.id,
          name: marker.name,
          coords: marker.coordinates,
          marked: true,
          markerKind: marker.kind,
        })),
      ],
    };
  }
  function pointData(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: visiblePoints.value.map((e) => ({
        type: 'Feature',
        id: e.id,
        geometry: { type: 'Point', coordinates: e.coordinates! },
        properties: { id: e.id, name: e.name, marked: e.visited },
      })),
    };
  }
  function visitedPointData(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: visitedResult.value.markers.map((marker) => ({
        type: 'Feature',
        id: marker.id,
        geometry: { type: 'Point', coordinates: marker.coordinates },
        properties: { id: marker.id, name: marker.name, kind: marker.kind },
      })),
    };
  }
  function closeVisitedSelection() {
    visitedSelectionRequest++;
    selectedVisitedIds.value = [];
  }
  function showVisitedSelection(ids: readonly string[]) {
    selectedVisitedIds.value = [...new Set(ids)].filter((id) => visitedById.value.has(id));
    hovered.value = undefined;
  }
  function selectVisitedMarker(id: string) {
    const marker = visitedById.value.get(id);
    if (!marker) return;
    visitedSelectionRequest++;
    showVisitedSelection([id]);
    if (map && ready)
      map.easeTo({
        center: marker.coordinates,
        zoom: marker.kind === 'project-reference' ? 7 : 14,
        duration: 250,
      });
    canvas?.focusPoints([id], marker.kind === 'project-reference' ? 2 : 24);
  }
  function selectCanvasMarkers(ids: string[]) {
    visitedSelectionRequest++;
    showVisitedSelection(ids);
    if (selectedVisitedMarkers.value.length)
      canvas?.focusPoints(
        ids,
        selectedVisitedMarkers.value.every((marker) => marker.kind === 'project-reference')
          ? 2
          : 24,
      );
  }
  function addVisitedImage(current: LibreMap, id: string) {
    if (current.hasImage(id)) return;
    const kind = id.replace(/^visited-/, '') as VisitedMarkerKind;
    const countMatch = /^visited-cluster-(\d+)$/.exec(id);
    if (!countMatch && !['airport', 'world-heritage', 'project-reference'].includes(kind)) return;
    const size = countMatch ? 40 : 34;
    const image = document.createElement('canvas');
    image.width = image.height = size * 2;
    const context = image.getContext('2d');
    if (!context) return;
    context.scale(2, 2);
    if (countMatch) drawVisitedCluster(context, Number(countMatch[1]), size / 2, size / 2);
    else drawVisitedMarker(context, kind, size / 2, size / 2);
    current.addImage(id, context.getImageData(0, 0, image.width, image.height), { pixelRatio: 2 });
  }
  async function selectTileMarker(current: LibreMap, feature: MapGeoJSONFeature) {
    if (!feature.properties.cluster) {
      selectVisitedMarker(String(feature.properties.id));
      return;
    }
    const token = generation;
    const request = ++visitedSelectionRequest;
    const source = current.getSource('visited-markers') as GeoJSONSource;
    try {
      const leaves = await source.getClusterLeaves(
        Number(feature.properties.cluster_id),
        Number(feature.properties.point_count),
        0,
      );
      if (token !== generation || current !== map || request !== visitedSelectionRequest) return;
      showVisitedSelection(leaves.map((leaf) => String(leaf.properties?.id)));
      const markers = selectedVisitedMarkers.value;
      if (!markers.length || feature.geometry.type !== 'Point') return;
      const samePoint = markers.every((marker) =>
        marker.coordinates.every(
          (value, i) => Math.abs(value - markers[0]!.coordinates[i]!) < 1e-8,
        ),
      );
      const maxZoom = markers.every((marker) => marker.kind === 'project-reference') ? 7 : 15;
      const expansion = samePoint
        ? Math.min(14, maxZoom)
        : Math.min(
            maxZoom,
            await source.getClusterExpansionZoom(Number(feature.properties.cluster_id)),
          );
      if (token !== generation || current !== map || request !== visitedSelectionRequest) return;
      if (expansion > current.getZoom() + 0.25)
        current.easeTo({
          center: feature.geometry.coordinates as [number, number],
          zoom: expansion,
          duration: 250,
        });
    } catch {
      // A record toggle or scope switch can replace the worker's cluster index.
      // The next click uses the current index; do not fall back or change records.
    }
  }
  async function loadSimple(scope = props.scope) {
    if (manifest && !manifest.scopes[scope]) throw Error('No published boundary for this topic');
    const response = await fetch(
      base + (manifest?.scopes[scope]?.simplified || `maps/${scope}.json`),
      {
        signal: controller
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw Error('Simplified map unavailable');
    return (await response.json()) as GeoJSON.FeatureCollection;
  }
  async function useFallback(token = generation) {
    if (token !== generation || fallingBack || canvas || missingBoundary.value) return;
    fallingBack = true;
    clearTimeout(timer);
    map?.remove();
    map = undefined;
    ready = false;
    loading.value = true;
    try {
      const geometry = await loadSimple();
      if (token !== generation || !mapHost.value) return;
      simple = geometry;
      fallback.value = true;
      canvas = new CanvasMapRenderer(
        mapHost.value,
        (id, point, markerIds) => (markerIds ? selectCanvasMarkers(markerIds) : select(id, point)),
        (hit) => (hovered.value = hit),
      );
      canvas.setScene(scene(), true);
      fitSelection();
      mapError.value = '';
    } catch {
      if (token === generation)
        mapError.value = '地图暂时无法载入，请检查连接后重试。列表与已有记录仍可使用。';
    } finally {
      if (token === generation) {
        loading.value = false;
        fallingBack = false;
      }
    }
  }
  function appearance() {
    if (canvas) {
      canvas.setScene(scene());
      return;
    }
    const scopeData = manifest?.scopes[props.scope];
    if (!map || !ready || !scopeData) return;
    for (const l of scopeData.layers) {
      for (const suffix of ['fill', 'line'])
        if (map.getLayer(l.level + '-' + suffix)) {
          map.setLayoutProperty(
            l.level + '-' + suffix,
            'visibility',
            l.level === level.value || l.level === 'border' ? 'visible' : 'none',
          );
        }
      if (l.level !== 'border')
        map.setPaintProperty(
          l.level + '-fill',
          'fill-opacity',
          boundaryFillOpacity(providerFailed.value ? null : provider.value),
        );
      map.setPaintProperty(l.level + '-line', 'line-color', [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#cf762b',
        ['boolean', ['feature-state', 'hover'], false],
        '#548774',
        store.dark ? '#91b0bb' : '#8ca49d',
      ]);
    }
    for (const r of store.session!.index.catalog.regions)
      if (r.scope === props.scope) {
        for (const l of scopeData.layers)
          if (l.level !== 'border')
            map.setFeatureState(
              { source: l.level, sourceLayer: 'regions', id: r.id },
              {
                fill: fill(r.id),
                selected: selected(r.id),
                recorded:
                  props.category && props.scope === 'china'
                    ? categoryRegions.value.has(r.id)
                    : store.session!.visitState(r.id) !== 'unvisited',
              },
            );
      }
    map.setPaintProperty('background', 'background-color', store.dark ? '#17272e' : '#eef4f3');
    (map.getSource('points') as GeoJSONSource).setData(pointData());
    if (lastVisitedResult !== visitedResult.value) {
      (map.getSource('visited-markers') as GeoJSONSource).setData(visitedPointData());
      lastVisitedResult = visitedResult.value;
    }
  }
  function fitRegion(id = '') {
    if (canvas) {
      canvas.fit(
        id
          ? scene()
              .features.filter((f) => store.session!.index.belongsTo(f.id, id))
              .map((f) => f.id)
          : undefined,
        props.scope === 'china' && store.session!.index.regions.get(id)?.level === 2 ? 0.82 : 1,
      );
    }
    const scopeData = manifest?.scopes[props.scope];
    if (map && ready && scopeData) {
      const b = id ? scopeData.regionBounds[id] : scopeData.bounds;
      const overviewZoom = props.scope === 'singapore' ? 11 : props.scope === 'brunei' ? 8 : 6;
      const detailZoom =
        props.scope === 'france' && level.value === 'county'
          ? 14
          : props.scope === 'france' && level.value === 'city'
            ? 11
            : props.scope === 'singapore'
              ? 12
              : 9;
      if (b)
        map.fitBounds(b, { padding: 45, maxZoom: id ? detailZoom : overviewZoom, duration: 0 });
    }
  }
  function fitSelection() {
    if (props.scope === 'france' && !props.selected && !validCoordinates(props.focus))
      fitFranceView('metropolitan');
    else fitRegion(props.selected);
    // Region fitting establishes a useful fallback before precise point focus.
    if (map && ready && validCoordinates(props.focus)) {
      map.jumpTo({ center: props.focus, zoom: 14 });
    }
  }
  function fitFranceView(group: 'metropolitan' | 'overseas') {
    if (props.scope !== 'france') return;
    const ids = store
      .session!.index.catalog.regions.filter(
        (region) => region.scope === 'france' && region.kind?.startsWith(group + '-'),
      )
      .map((region) => region.id);
    if (!ids.length) return;
    if (canvas) canvas.fit(ids);
    const scopeData = manifest?.scopes.france;
    if (!map || !ready || !scopeData) return;
    const boxes = ids
      .map((id) => scopeData.regionBounds[id])
      .filter((bounds): bounds is Bounds => Boolean(bounds));
    if (!boxes.length) return;
    const bounds = boxes.reduce<Bounds>(
      (merged, box) => [
        Math.min(merged[0], box[0]),
        Math.min(merged[1], box[1]),
        Math.max(merged[2], box[2]),
        Math.max(merged[3], box[3]),
      ],
      [...boxes[0]!] as Bounds,
    );
    map.fitBounds(bounds, { padding: 45, maxZoom: 6, duration: 0 });
  }
  function zoom(factor: number) {
    canvas?.zoom(factor);
    if (canvas) mapZoom.value += Math.log2(factor);
    if (map && ready) map.zoomTo(map.getZoom() + Math.log2(factor), { duration: 180 });
  }
  async function exportPng() {
    // Export only our own geometry, independent of provider licensing or raster failures.
    const token = generation;
    let renderer: CanvasMapRenderer | undefined, holder: HTMLElement | undefined;
    try {
      const geometry = simple || (await loadSimple());
      if (token !== generation) return;
      simple = geometry;
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1600px;height:1000px';
      document.body.append(holder);
      renderer = new CanvasMapRenderer(holder, () => {});
      await new Promise(requestAnimationFrame);
      renderer.setScene(scene(), true);
      if (props.selected)
        renderer.fit(
          scene()
            .features.filter((f) => selected(f.id))
            .map((f) => f.id),
        );
      download(
        await renderer.png(
          '方舆旅行地图',
          Object.entries(VISIT_LABELS).map(([state, label]) => ({
            label,
            color: store.colors[state as keyof typeof VISIT_LABELS],
          })),
          mapAttributions(props.scope, visitedLayers.value.visitedWorldHeritage).map(
            (credit) => `${credit.label} · ${credit.url}`,
          ),
        ),
        '方舆地图.png',
      );
    } catch {
      mapError.value = '地图图片暂时无法生成，请重试。';
    } finally {
      renderer?.destroy();
      holder?.remove();
    }
  }
  function initialize() {
    pendingProviderCamera = undefined;
    return initializeMap();
  }
  function changeProvider() {
    // Switching the visual background must not reset a manually chosen viewport.
    if (map && ready)
      pendingProviderCamera = { center: map.getCenter().toArray(), zoom: map.getZoom() };
    return initializeMap(pendingProviderCamera);
  }
  async function initializeMap(camera?: Camera) {
    const token = ++generation;
    controller?.abort();
    controller = new AbortController();
    clearTimeout(timer);
    map?.remove();
    canvas?.destroy();
    map = undefined;
    canvas = undefined;
    simple = undefined;
    lastVisitedResult = undefined;
    manifest = undefined;
    ready = false;
    fallingBack = false;
    loading.value = true;
    fallback.value = false;
    providerFailed.value = false;
    missingBoundary.value = false;
    mapError.value = '';
    hovered.value = undefined;
    mapZoom.value = camera?.zoom || 0;
    mapCenter.value = null;
    try {
      const response = await fetch(base + 'map-manifest.json', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw Error('Map manifest unavailable');
      const nextManifest = (await response.json()) as MapDataManifest;
      if (token !== generation || !mapHost.value) return;
      manifest = nextManifest;
      const scopeData = manifest.scopes[props.scope];
      if (!scopeData) {
        missingBoundary.value = true;
        loading.value = false;
        mapError.value = '该专题尚无已发布的边界地图，地点列表与已有记录仍可使用。';
        return;
      }
      map = new LibreMap({
        container: mapHost.value,
        style: createMapStyle(
          manifest,
          props.scope,
          level.value,
          provider.value,
          base,
          location.href,
        ),
        bounds: scopeData.bounds,
        fitBoundsOptions: { padding: 45 },
        attributionControl: { compact: true },
        renderWorldCopies: false,
        maxZoom: 15,
        dragRotate: false,
        touchPitch: false,
      });
      const current = map;
      // MapLibre 6 resolves image dependencies before emitting styleimagemissing.
      // Supply dynamic count images in its awaited resolver so the same worker
      // request receives them; adding them in that later event misses this tile.
      current.setMissingStyleImageResolver((id) => {
        if (token === generation && current === map) addVisitedImage(current, id);
      });
      timer = setTimeout(() => {
        if (token === generation && loading.value) void useFallback(token);
      }, 15000);
      current.on('style.load', () => {
        if (token !== generation || current !== map) return;
        ready = true;
        for (const kind of ['airport', 'world-heritage', 'project-reference'])
          addVisitedImage(current, 'visited-' + kind);
        appearance();
        fitSelection();
        if (camera) current.jumpTo(camera);
        mapZoom.value = current.getZoom();
        mapCenter.value = current.getCenter().toArray();
      });
      current.on('moveend', () => {
        if (token === generation && current === map) {
          mapZoom.value = current.getZoom();
          mapCenter.value = current.getCenter().toArray();
        }
      });
      current.on('idle', () => {
        if (token !== generation || current !== map) return;
        loading.value = false;
        clearTimeout(timer);
      });
      current.on('error', (e) => {
        if (token !== generation || current !== map) return;
        const sourceId = (e as { sourceId?: string }).sourceId;
        if (sourceId === 'basemap' || sourceId === 'labels') {
          providerFailed.value = true;
          for (const id of ['basemap', 'labels']) if (current.getLayer(id)) current.removeLayer(id);
          for (const id of ['basemap', 'labels'])
            if (current.getSource(id)) current.removeSource(id);
          appearance();
        } else void useFallback(token);
      });
      current.on('webglcontextlost', () => {
        if (token === generation) void useFallback(token);
      });
      current.on('click', (e) => {
        if (!ready || current !== map) return;
        const visited = current.queryRenderedFeatures(e.point, {
          layers: VISITED_MARKER_LAYER_IDS.filter((id) => current.getLayer(id)),
        })[0];
        if (visited) {
          void selectTileMarker(current, visited);
          return;
        }
        const point = current.queryRenderedFeatures(e.point, { layers: ['points'] })[0];
        if (point) {
          select(String(point.properties.id), true);
          return;
        }
        const layer = level.value + '-fill';
        if (!current.getLayer(layer)) return;
        const f = current
          .queryRenderedFeatures(e.point, { layers: [layer] })
          .find((f) => store.session!.index.regions.has(String(f.properties.regionId)));
        if (f) {
          const allowed = regionInteractionPolicy(props.scope);
          if (allowed && !allowed([e.lngLat.lng, e.lngLat.lat], f.geometry)) {
            hovered.value = undefined;
            current.getCanvas().style.cursor = '';
            return;
          }
          select(String(f.properties.regionId), false);
        }
      });
      current.on('mousemove', (e) => {
        if (!ready || current !== map) return;
        const visited = current.queryRenderedFeatures(e.point, {
          layers: VISITED_MARKER_LAYER_IDS.filter((id) => current.getLayer(id)),
        })[0];
        if (visited) {
          hovered.value = {
            id: String(visited.properties.id || visited.properties.cluster_id),
            name: String(visited.properties.name || ''),
            point: true,
            x: e.point.x,
            y: e.point.y,
            markerCount: Number(visited.properties.point_count || 1),
            ...(visited.properties.cluster ? {} : { markerIds: [String(visited.properties.id)] }),
          };
          current.getCanvas().style.cursor = 'pointer';
          return;
        }
        const layers = ['points', level.value + '-fill'].filter((id) => current.getLayer(id));
        const f = current
          .queryRenderedFeatures(e.point, { layers })
          .find(
            (f) =>
              f.layer.id === 'points' ||
              (store.session!.index.regions.has(String(f.properties.regionId)) &&
                (regionInteractionPolicy(props.scope)?.([e.lngLat.lng, e.lngLat.lat], f.geometry) ??
                  true)),
          );
        hovered.value = f
          ? {
              id: String(f.properties.regionId || f.properties.id),
              name: String(f.properties.name || ''),
              point: f.layer.id === 'points',
              x: e.point.x,
              y: e.point.y,
            }
          : undefined;
        current.getCanvas().style.cursor = f ? 'pointer' : '';
      });
      current.getCanvas().addEventListener('mouseleave', () => (hovered.value = undefined), {
        signal: controller.signal,
      });
    } catch {
      if (token === generation) await useFallback(token);
    }
  }
  onMounted(() => {
    observer = new ResizeObserver(() => {
      if (mapHost.value?.clientWidth && mapHost.value?.clientHeight) map?.resize();
    });
    if (mapHost.value) observer.observe(mapHost.value);
    void initialize();
  });
  onBeforeUnmount(() => {
    generation++;
    controller?.abort();
    clearTimeout(timer);
    observer?.disconnect();
    map?.remove();
    canvas?.destroy();
  });
  watch(() => props.scope, initialize);
  watch(provider, changeProvider);
  watch(
    () => [store.revision, store.dark, props.category, props.level, props.selected],
    appearance,
  );
  watch(() => [props.selected, props.level, props.focus], fitSelection);
  watch(visiblePoints, appearance);
  watch(visitedResult, () => {
    visitedSelectionRequest++;
    selectedVisitedIds.value = selectedVisitedIds.value.filter((id) => visitedById.value.has(id));
    if (hovered.value?.markerIds || hovered.value?.markerCount) hovered.value = undefined;
    appearance();
  });
  watch(() => props.scope, closeVisitedSelection);
  return {
    store,
    host,
    mapHost,
    hoverInfo,
    hoverStyle,
    showPoints,
    mapError,
    loading,
    fallback,
    provider,
    providerFailed,
    missingBoundary,
    mapZoom,
    mapCenter,
    visiblePointCount,
    visitedResult,
    visitedLayers,
    selectedVisitedMarkers,
    selectVisitedMarker,
    closeVisitedSelection,
    initialize,
    useFallback: () => useFallback(),
    generation,
    zoom,
    fitRegion,
    fitSelection,
    fitFranceView,
    exportPng,
  };
}
