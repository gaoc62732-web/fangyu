import { computed, shallowRef, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl';
import { VISIT_LABELS, getScopeConfig, type Scope } from '@fangyu/contracts';
import { CanvasMapRenderer, geographicClusters, pointVisitColors } from '@fangyu/map-renderer';
import { useAppStore } from '../../app/store.js';
import { download } from '../exports/download.js';
import { type Bounds, type MapDataManifest } from './types.js';
import { basemapConfiguredProvider, basemapEnabled, basemapKind } from './basemap-settings.js';
import { mapAttributions } from './data-attribution.js';
import {
  boundaryFillOpacity,
  boundaryOverlayFillOpacity,
  createMapStyle,
} from './style.js';
import type { TiledMapProps } from './types.js';
import { validCoordinates } from './map-coordinates.js';
import { useMapScene } from './use-map-scene.js';
import { useMapInteractions } from './use-map-interactions.js';
import {
  chinaBoundaryFeatureGroup,
  chinaBoundaryGroups,
  chinaBoundaryManagedRegionIds,
  chinaBoundaryLayerId,
  chinaBoundarySourceId,
  chinaBoundaryLines,
  chinaBoundaryBounds,
} from './china-boundaries.js';
import { chinaRegionSourceLevels, isChinaCountyMapVisible } from './china-map-levels.js';
export function useTiledMap(props: TiledMapProps, select: (id: string, point: boolean) => void) {
  const store = useAppStore();
  const host = ref<HTMLElement>(),
    mapHost = ref<HTMLElement>();
  const mapError = ref(''),
    loading = ref(true),
    fallback = ref(false),
    providerFailed = ref(false),
    missingBoundary = ref(false);
  const mapZoom = ref(0);
  const mapCenter = ref<[number, number] | null>(null);
  const base = import.meta.env.BASE_URL;
  // Keep the configured provider in the map style even while it is hidden so
  // toggling the checkbox only changes layer visibility and never recreates the map.
  const provider = computed(() => basemapConfiguredProvider.value);
  function mapDebugRequested() {
    const routeQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
    return (
      new URLSearchParams(location.search).has('mapDebug') ||
      new URLSearchParams(routeQuery).has('mapDebug')
    );
  }
  const regionAutoFocus = computed(() => {
    void store.revision;
    return store.session!.preferences.regionAutoFocus !== false;
  });
  let map: LibreMap | undefined, canvas: CanvasMapRenderer | undefined;
  const manifest = shallowRef<MapDataManifest>();
  const simple = shallowRef<GeoJSON.FeatureCollection>();
  let generation = 0,
    ready = false,
    fallingBack = false,
    disposed = false;
  let observer: ResizeObserver | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  type Camera = { center: [number, number]; zoom: number };
  let pendingProviderCamera: Camera | undefined;
  const viewportRevision = ref(0);
  let initialPointsChecked = false;
  function captureView() {
    const camera =
      map && ready
        ? { center: map.getCenter().toArray(), zoom: map.getZoom() }
        : canvas?.camera?.();
    if (camera) {
      mapZoom.value = camera.zoom;
      mapCenter.value = camera.center;
    }
    viewportRevision.value++;
    if (!props.pointMode) {
      const previous = store.regionalMap;
      const sameCamera = camera
        ? previous?.camera &&
          Math.abs(previous.camera.zoom - camera.zoom) < 1e-9 &&
          camera.center.every((value, i) => Math.abs(value - previous.camera!.center[i]!) < 1e-9)
        : !previous?.camera;
      // Canvas drawing reports its camera too. Avoid feeding an unchanged view
      // back through the parent page and triggering another scene redraw.
      if (
        previous?.scope === props.scope &&
        previous.selected === props.selected &&
        previous.level === props.level &&
        sameCamera
      )
        return;
      store.regionalMap = {
        scope: props.scope,
        selected: props.selected,
        level: props.level,
        ...(camera ? { camera } : {}),
      };
    }
  }
  function projectPoint(coordinates: [number, number]): [number, number] | undefined {
    if (map && ready) {
      const p = map.project(coordinates);
      return [p.x, p.y];
    }
    return canvas?.projectPoint?.(coordinates);
  }
  const pointClusterTrees = computed(() => {
    const highlighted = new Set(props.highlightedPointIds || []);
    type Marker = { id: string; coordinates: [number, number]; value: (typeof visiblePoints.value)[number] };
    const ordinary: Marker[] = [];
    const focused: Marker[] = [];
    for (const entry of visiblePoints.value) {
      const marker = { id: entry.id, coordinates: entry.coordinates!, value: entry };
      (highlighted.has(entry.id) ? focused : ordinary).push(marker);
    }
    return [
      { tree: geographicClusters(ordinary, 64, 48), highlighted: false },
      { tree: geographicClusters(focused, 28, 44), highlighted: true },
    ];
  });
  const pointGroups = computed(() => {
    void viewportRevision.value;
    if (!props.pointMode) return [];
    const width = mapHost.value?.clientWidth || 0,
      height = mapHost.value?.clientHeight || 0;
    const bounds = map && ready ? map.getBounds() : undefined;
    const west = bounds?.getWest() ?? -Infinity;
    const east = bounds?.getEast() ?? Infinity;
    const south = bounds?.getSouth() ?? -Infinity;
    const north = bounds?.getNorth() ?? Infinity;
    return pointClusterTrees.value.flatMap(({ tree, highlighted }) =>
      tree.atZoom(mapZoom.value).flatMap((group) => {
        const [longitude, latitude] = group.coordinates;
        if (latitude < south || latitude > north || longitude < west || longitude > east) return [];
        const p = projectPoint(group.coordinates);
        return p && p[0] >= -24 && p[0] <= width + 24 && p[1] >= -24 && p[1] <= height + 24
          ? [{ ...group, x: p[0], y: p[1], highlighted }]
          : [];
      }),
    );
  });
  function revealInitialPoints() {
    if (!props.pointMode || initialPointsChecked) return;
    const points = visiblePoints.value;
    if (!points.length) return;
    initialPointsChecked = true;
    if (pointGroups.value.length) return;
    const center = mapCenter.value;
    const local = points.filter(
      (e) =>
        props.selected &&
        store
          .session!.index.entryRegions(e, props.scope)
          .some((id) => store.session!.index.belongsTo(id, props.selected)),
    );
    const candidates = local.length ? local : points;
    const target = center
      ? candidates.reduce((a, b) => {
          const distance = (e: typeof a) =>
            Math.hypot(e.coordinates![0] - center[0], e.coordinates![1] - center[1]);
          return distance(a) <= distance(b) ? a : b;
        })
      : candidates[0]!;
    if (map && ready)
      map.easeTo({
        center: target.coordinates!,
        zoom: Math.max(7, Math.min(map.getZoom(), 11)),
        duration: 650,
      });
    else if (canvas) canvas.setCamera({ center: target.coordinates!, zoom: 8 });
  }
  function expandCluster(ids: string[], expansionZoom?: number) {
    const members = visiblePoints.value.filter((e) => ids.includes(e.id));
    if (!members.length) return;
    const center: [number, number] = [
      members.reduce((sum, e) => sum + e.coordinates![0], 0) / members.length,
      members.reduce((sum, e) => sum + e.coordinates![1], 0) / members.length,
    ];
    const zoom = Math.min(20, Math.max(mapZoom.value + .5, expansionZoom === undefined ? mapZoom.value + 1.5 : expansionZoom + .05));
    if (map && ready) map.easeTo({ center, zoom, duration: 450 });
    else if (canvas) canvas.setCamera({ center, zoom });
  }
  const level = computed(() =>
    props.scope === 'china' || props.scope === 'france'
      ? props.level
      : manifest.value?.scopes[props.scope]?.layers.find((l) => l.level !== 'border')?.level ||
        getScopeConfig(props.scope).defaultLevel,
  );
  const drawing = useMapScene(props, host, mapZoom, level, simple, (id) => {
    const boundaryData = props.scope === 'china' ? store.chinaBoundaryData : undefined;
    return boundaryData
      ? chinaBoundaryBounds(boundaryData, store.chinaBoundarySettings, id)
      : manifest.value?.scopes[props.scope]?.regionBounds[id];
  });
  const {
    hovered,
    showPoints,
    visitedLayers,
    visitedResult,
    visiblePoints,
    visiblePointCount,
    categoryRegions,
    fill,
    selected,
    previewIds,
    hoverInfo,
    hoverStyle,
    scene,
    pointData,
    visitedPointData,
  } = drawing;
  const boundaryGroupPendingKeys: string[] = [];
  const {
    selectedVisitedMarkers,
    selectVisitedMarker,
    closeVisitedSelection,
    selectCanvasMarkers,
    addVisitedImage,
    addSelectedRegionHatch,
    bindInteractions,
  } = useMapInteractions(
    props,
    level,
    drawing,
    {
      map: () => map,
      canvas: () => canvas,
      ready: () => ready && !boundaryGroupPendingKeys.some(Boolean),
    },
    select,
  );
  let boundaryLease: { release: () => void } | undefined;
  let boundaryLeaseRequest: Promise<void> | undefined;
  const boundaryFeatureGroups: (GeoJSON.FeatureCollection | undefined)[] = [];
  const boundaryGroupKeys: string[] = [];
  const boundaryGroupUpdates: Promise<void>[] = [];
  const featureStateCache = new Map<string, Record<string, string | boolean>>();
  const selectedFeatureStates = new Set<string>();
  const styleValueCache = new Map<string, string>();
  let pointDataKey = '';
  let visitedPointDataKey = '';
  let boundaryLineKey = '';
  let boundaryOrdinaryFilterKey = '';
  // A point page may be the first map route. It still needs one complete
  // regional state pass so its administrative fills start with the saved
  // visit colors; subsequent point-mode updates can stay lightweight.
  let pointModeStateInitialized = false;
  let lastPointMode: boolean | undefined;
  let lastCategoryColorMode: boolean | undefined;
  function setLayoutProperty(layer: string, property: string, value: unknown) {
    if (!map || !map.getLayer(layer)) return;
    const key = `layout:${layer}:${property}`;
    const serialized = JSON.stringify(value) ?? 'undefined';
    if (styleValueCache.get(key) === serialized) return;
    map.setLayoutProperty(layer, property as never, value as never);
    styleValueCache.set(key, serialized);
  }
  function setPaintProperty(layer: string, property: string, value: unknown) {
    if (!map || !map.getLayer(layer)) return;
    const key = `paint:${layer}:${property}`;
    const serialized = JSON.stringify(value) ?? 'undefined';
    if (styleValueCache.get(key) === serialized) return;
    map.setPaintProperty(layer, property as never, value as never);
    styleValueCache.set(key, serialized);
  }
  function setFilter(layer: string, value: import('maplibre-gl').FilterSpecification) {
    if (!map || !map.getLayer(layer)) return;
    const key = `filter:${layer}`;
    const serialized = JSON.stringify(value) ?? 'undefined';
    if (styleValueCache.get(key) === serialized) return;
    map.setFilter(layer, value);
    styleValueCache.set(key, serialized);
  }
  function clearDebugMap(instance: LibreMap | undefined) {
    const debug = globalThis as typeof globalThis & { __fangyuMap?: LibreMap };
    if (instance && debug.__fangyuMap === instance) delete debug.__fangyuMap;
  }
  function setFeatureState(
    target: { source: string; sourceLayer?: string; id: string },
    state: Record<string, string | boolean>,
  ) {
    if (!map) return;
    const key = [target.source, target.sourceLayer || '', target.id].join('\0');
    const previous = featureStateCache.get(key);
    const next = { ...previous, ...state };
    const changed = Object.fromEntries(
      Object.entries(state).filter(([property, value]) => previous?.[property] !== value),
    );
    if (Object.keys(changed).length) map.setFeatureState(target, changed);
    featureStateCache.set(key, next);
    if (state.selected === true) selectedFeatureStates.add(key);
    else if (state.selected === false) selectedFeatureStates.delete(key);
  }
  function sourceLevelsForRegion(
    region: import('@fangyu/contracts').Region,
    scopeData: MapDataManifest['scopes'][Scope],
    regions: ReadonlyMap<string, import('@fangyu/contracts').Region>,
  ) {
    const available = new Set(scopeData.layers.map((layer) => layer.level));
    if (available.has('city') || available.has('county')) {
      const levels =
        region.scope === 'china'
          ? chinaRegionSourceLevels(region, regions)
          : region.level === 0
            ? ['province']
            : region.level === 1
              ? ['city']
              : region.level === 2
                ? ['county']
                : [];
      return levels.filter((level) => available.has(level));
    }
    const level = scopeData.layers.find((layer) => layer.level !== 'border')?.level;
    return level ? [level] : [];
  }
  function regionRecorded(id: string) {
    if (!props.pointMode && props.category && props.scope === 'china')
      return categoryRegions.value.has(id);
    return store.session!.visitState(id) !== 'unvisited';
  }
  function setBoundaryFeatureStates(
    index: number,
    features: GeoJSON.Feature[],
    afterUpdate = false,
  ) {
    if (!afterUpdate && boundaryGroupPendingKeys[index]) return;
    const source = chinaBoundarySourceId(index);
    for (const feature of features) {
      const id = String(feature.id);
      setFeatureState(
        { source, id },
        {
          fill: fill(id),
          selected: selected(id),
          recorded: regionRecorded(id),
        },
      );
    }
  }
  function queueBoundaryGroupUpdate(
    index: number,
    source: GeoJSONSource,
    key: string,
    next: GeoJSON.FeatureCollection,
    previous: GeoJSON.FeatureCollection | undefined,
  ) {
    const sourceId = chinaBoundarySourceId(index);
    const token = generation;
    const isCurrent = () => token === generation && map?.getSource(sourceId) === source;
    boundaryGroupPendingKeys[index] = key;
    hovered.value = undefined;
    if (map) map.getCanvas().style.cursor = '';
    boundaryGroupUpdates[index] = (boundaryGroupUpdates[index] || Promise.resolve())
      .then(() => (isCurrent() ? source.setData(next) : undefined))
      .then(() => {
        if (!isCurrent() || boundaryGroupKeys[index] !== key) return;
        const nextIds = new Set(next.features.map((feature) => String(feature.id)));
        for (const feature of previous?.features || []) {
          const id = String(feature.id);
          if (nextIds.has(id)) continue;
          map!.removeFeatureState({ source: sourceId, id });
          featureStateCache.delete([sourceId, '', id].join('\0'));
          selectedFeatureStates.delete([sourceId, '', id].join('\0'));
        }
        for (const feature of next.features)
          featureStateCache.delete([sourceId, '', String(feature.id)].join('\0'));
        boundaryGroupPendingKeys[index] = '';
        setBoundaryFeatureStates(index, next.features, true);
        if (mapError.value === '地区归属边界更新失败，地图仍可继续使用。') mapError.value = '';
      })
      .catch(() => {
        if (!isCurrent() || boundaryGroupKeys[index] !== key) return;
        boundaryGroupPendingKeys[index] = '';
        boundaryGroupKeys[index] = '';
        mapError.value = '地区归属边界更新失败，地图仍可继续使用。';
      });
  }
  async function acquireBoundaryLease() {
    if (boundaryLease) return;
    boundaryLeaseRequest ||= store
      .acquireChinaBoundaries()
      .then((lease) => {
        if (props.scope === 'china') boundaryLease = lease;
        else lease.release();
      })
      .finally(() => (boundaryLeaseRequest = undefined));
    await boundaryLeaseRequest;
  }
  function releaseBoundaryLease() {
    boundaryLease?.release();
    boundaryLease = undefined;
    boundaryFeatureGroups.length = 0;
    boundaryGroupKeys.length = 0;
    boundaryGroupUpdates.length = 0;
    boundaryGroupPendingKeys.length = 0;
    boundaryLineKey = '';
    boundaryOrdinaryFilterKey = '';
  }
  async function loadSimple(scope = props.scope, exportLevel?: string) {
    if (scope === 'china' && manifest.value?.scopes.china?.boundaryOptions)
      await acquireBoundaryLease();
    if (manifest.value && !manifest.value.scopes[scope])
      throw Error('No published boundary for this topic');
    const response = await fetch(
      base +
        ((exportLevel && manifest.value?.scopes[scope]?.simplifiedLevels?.[exportLevel]) ||
          manifest.value?.scopes[scope]?.simplified ||
          `maps/${scope}.json`),
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
    providerFailed.value = true;
    fallback.value = false;
    if (map && ready) toggleBasemapVisibility();
    else if (!map) mapError.value = '地图暂时无法载入，请重试。';
    if (token === generation) {
      loading.value = false;
      fallingBack = false;
    }
  }
  function updateModeLayers() {
    if (!map || !ready) return;
    setLayoutProperty('point-basemap-mask', 'visibility', props.pointMode ? 'visible' : 'none');
    const basemapVisible = basemapEnabled.value && !providerFailed.value;
    for (const layer of map.getStyle().layers) {
      if (layer.id === 'points')
        setLayoutProperty(layer.id, 'visibility', props.pointMode ? 'none' : 'visible');
      if (layer.id === 'labels' || (layer.type === 'symbol' && layer.id.startsWith('base-')))
        setLayoutProperty(layer.id, 'visibility', basemapVisible ? 'visible' : 'none');
    }
  }
  function updatePointHighlights(scopeData: MapDataManifest['scopes'][Scope]) {
    if (!map) return;
    const replacedIds =
      props.scope === 'china' && store.chinaBoundaryData
        ? chinaBoundaryManagedRegionIds(store.chinaBoundaryData)
        : [];
    for (const layer of scopeData.layers.filter((layer) => layer.level !== 'border')) {
      const ids = previewIds(layer.level);
      const filter = [
        'all',
        ['!', ['in', ['get', 'regionId'], ['literal', replacedIds]]],
        ['in', ['get', 'regionId'], ['literal', ids]],
      ] as import('maplibre-gl').FilterSpecification;
      setFilter(layer.level + '-point-highlight', filter);
      setLayoutProperty(
        layer.level + '-point-highlight',
        'visibility',
        props.pointMode && ids.length ? 'visible' : 'none',
      );
      if (props.scope === 'china' && scopeData.boundaryOptions)
        for (let index = 0; index < (scopeData.boundaryOptionGroups || 0); index++) {
          const highlight = chinaBoundaryLayerId(index, layer.level + '-point-highlight');
          setFilter(highlight, filter);
          setLayoutProperty(
            highlight,
            'visibility',
            props.pointMode && ids.length ? 'visible' : 'none',
          );
        }
    }
  }
  function updateCategoryModeColors(scopeData: MapDataManifest['scopes'][Scope]) {
    if (!map) return;
    const regions = store.session!.index.catalog.regions;
    for (const region of regions) {
      if (region.scope !== props.scope) continue;
      for (const source of sourceLevelsForRegion(region, scopeData, store.session!.index.regions))
        if (source !== 'border')
          setFeatureState(
            { source, sourceLayer: 'regions', id: region.id },
            {
              fill: fill(region.id),
              recorded: regionRecorded(region.id),
            },
          );
    }
    if (props.scope === 'china' && scopeData.boundaryOptions)
      for (let index = 0; index < boundaryFeatureGroups.length; index++)
        setBoundaryFeatureStates(index, boundaryFeatureGroups[index]?.features || []);
  }
  function updateModePaint(scopeData: MapDataManifest['scopes'][Scope]) {
    if (!map) return;
    for (const layer of scopeData.layers) {
      if (layer.level !== 'border')
        setPaintProperty(
          layer.level + '-fill',
          'fill-opacity',
          boundaryFillOpacity(provider.value),
        );
      setPaintProperty(layer.level + '-line', 'line-opacity', 1);
      setPaintProperty(layer.level + '-line', 'line-width', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        1.5,
        layer.level === 'border' ? 2.6 : layer.level === 'county' ? 0.5 : 1,
      ]);
      if (layer.level !== 'border')
        for (let index = 0; index < (scopeData.boundaryOptionGroups || 0); index++) {
          const suffix = layer.level;
          setPaintProperty(
            chinaBoundaryLayerId(index, suffix + '-fill'),
            'fill-opacity',
            boundaryOverlayFillOpacity(provider.value),
          );
          setPaintProperty(chinaBoundaryLayerId(index, suffix + '-line'), 'line-opacity', 1);
          setPaintProperty(chinaBoundaryLayerId(index, suffix + '-line'), 'line-width', [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1.5,
            layer.level === 'county' ? 0.5 : 1,
          ]);
        }
    }
    if (props.pointMode) updatePointHighlights(scopeData);
    else
      for (const layer of scopeData.layers.filter((layer) => layer.level !== 'border')) {
        setLayoutProperty(layer.level + '-point-highlight', 'visibility', 'none');
        for (let index = 0; index < (scopeData.boundaryOptionGroups || 0); index++)
          setLayoutProperty(
            chinaBoundaryLayerId(index, layer.level + '-point-highlight'),
            'visibility',
            'none',
          );
      }
  }
  function updateSelectedOutlineFilters(scopeData: MapDataManifest['scopes'][Scope]) {
    if (!map) return;
    const regionsById = store.session!.index.regions;
    const replacedIds =
      props.scope === 'china' && store.chinaBoundaryData
        ? chinaBoundaryManagedRegionIds(store.chinaBoundaryData)
        : [];
    for (const layer of scopeData.layers.filter((item) => item.level !== 'border')) {
      const muted = Boolean(props.regionMode && props.selectionMuted);
      const ids = store
        .session!.index.catalog.regions.filter(
          (region) =>
            region.scope === props.scope &&
            selected(region.id) &&
            (layer.level !== 'county' ||
              props.scope !== 'china' ||
              isChinaCountyMapVisible(region, regionsById, store.chinaBoundarySettings)) &&
            sourceLevelsForRegion(region, scopeData, store.session!.index.regions).includes(
              layer.level as 'province' | 'city' | 'county',
            ),
        )
        .map((region) => region.id);
      const selectedFilter: import('maplibre-gl').FilterSpecification = [
        'in',
        ['get', 'regionId'],
        ['literal', ids],
      ];
      setFilter(
        layer.level + '-selected-outline',
        ids.length
          ? ['all', ['!', ['in', ['get', 'regionId'], ['literal', replacedIds]]], selectedFilter]
          : selectedFilter,
      );
      setPaintProperty(
        layer.level + '-selected-outline',
        'fill-outline-color',
        muted ? '#c18a5d' : '#cf762b',
      );
      setLayoutProperty(
        layer.level + '-selected-outline',
        'visibility',
        layer.level === level.value ? 'visible' : 'none',
      );
      if (props.scope === 'china' && scopeData.boundaryOptions)
        for (let index = 0; index < (scopeData.boundaryOptionGroups || 0); index++) {
          const outline = chinaBoundaryLayerId(index, layer.level + '-selected-outline');
          setFilter(outline, ['all', ['==', ['get', 'level'], layer.level], selectedFilter]);
          setPaintProperty(outline, 'fill-outline-color', muted ? '#c18a5d' : '#cf762b');
        }
    }
  }
  function updateModeSelection(scopeData: MapDataManifest['scopes'][Scope]) {
    // Point previews use the same feature-state bit as regional selection.
    // Clear only states that were actually selected, then set the selected
    // region's faces. Track just selected features to avoid an all-region scan
    // when a shared map changes mode.
    for (const key of [...selectedFeatureStates]) {
      const [source, sourceLayer, id] = key.split('\0');
      if (source && id)
        setFeatureState(
          { source, ...(sourceLayer ? { sourceLayer } : {}), id },
          { selected: false },
        );
    }
    if (props.pointMode) {
      for (const id of drawing.previewTargets.value) {
        const region = store.session!.index.regions.get(id);
        if (!region || region.scope !== props.scope) continue;
        for (const source of sourceLevelsForRegion(region, scopeData, store.session!.index.regions))
          if (source !== 'border')
            setFeatureState({ source, sourceLayer: 'regions', id }, { selected: true });
      }
      for (let index = 0; index < boundaryFeatureGroups.length; index++)
        setBoundaryFeatureStates(index, boundaryFeatureGroups[index]?.features || []);
      updateSelectedOutlineFilters(scopeData);
      return;
    }
    for (const region of store.session!.index.catalog.regions) {
      if (region.scope !== props.scope || !selected(region.id)) continue;
      for (const source of sourceLevelsForRegion(region, scopeData, store.session!.index.regions))
        if (source !== 'border')
          setFeatureState({ source, sourceLayer: 'regions', id: region.id }, { selected: true });
    }
    for (let index = 0; index < boundaryFeatureGroups.length; index++)
      setBoundaryFeatureStates(index, boundaryFeatureGroups[index]?.features || []);
    updateSelectedOutlineFilters(scopeData);
  }
  function appearance() {
    if (canvas) {
      canvas.setScene(scene());
      return;
    }
    const scopeData = manifest.value?.scopes[props.scope];
    if (!map || !ready || !scopeData) return;
    const modeChanged = lastPointMode !== undefined && lastPointMode !== props.pointMode;
    const pointColors = pointVisitColors(store.colors);
    setPaintProperty('points', 'circle-color', ['case', ['boolean', ['get', 'marked'], false], pointColors.visitedColor,
      ['boolean', ['get', 'partial'], false], pointColors.partialColor, pointColors.unvisitedColor]);
    const categoryColorMode =
      !props.pointMode && Boolean(props.category) && props.scope === 'china';
    const categoryColorModeChanged =
      lastCategoryColorMode !== undefined && lastCategoryColorMode !== categoryColorMode;
    lastPointMode = Boolean(props.pointMode);
    lastCategoryColorMode = categoryColorMode;
    // The shared map keeps one style for both modules. Mode changes therefore
    // update layer state in place instead of rebuilding the MapLibre instance.
    updateModeLayers();
    updateModePaint(scopeData);
    if (modeChanged && pointModeStateInitialized) {
      if (categoryColorModeChanged) updateCategoryModeColors(scopeData);
      updateModeSelection(scopeData);
      return;
    }
    const countyIds = store
      .session!.index.catalog.regions.filter((r) =>
        isChinaCountyMapVisible(r, store.session!.index.regions, store.chinaBoundarySettings),
      )
      .map((r) => r.id);
    const replacedIds =
      props.scope === 'china' && store.chinaBoundaryData
        ? chinaBoundaryManagedRegionIds(store.chinaBoundaryData)
        : [];
    const ordinaryFilterKey =
      props.scope + ':' + JSON.stringify(replacedIds) + ':' + JSON.stringify(countyIds);
    if (ordinaryFilterKey !== boundaryOrdinaryFilterKey) {
      for (const l of scopeData.layers.filter((l) => l.level !== 'border')) {
        const filter: import('maplibre-gl').FilterSpecification = [
          'all',
          ['!', ['in', ['get', 'regionId'], ['literal', replacedIds]]],
          ...(props.scope === 'china' && l.level === 'county'
            ? ([
                ['in', ['get', 'regionId'], ['literal', countyIds]],
              ] as import('maplibre-gl').ExpressionSpecification[])
            : []),
        ];
        for (const suffix of ['fill', 'line']) setFilter(l.level + '-' + suffix, filter);
      }
      boundaryOrdinaryFilterKey = ordinaryFilterKey;
    }
    if (props.scope === 'china' && store.chinaBoundaryData && scopeData.boundaryOptions) {
      const data = store.chinaBoundaryData;
      const settings = store.chinaBoundarySettings;
      const groups = chinaBoundaryGroups(data);
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index]!;
        const sourceId = chinaBoundarySourceId(index);
        const source = map.getSource(sourceId) as GeoJSONSource | undefined;
        if (!source) continue;
        const groupKey = group.keys.map((key) => (settings[key] ? '1' : '0')).join('');
        if (groupKey !== boundaryGroupKeys[index]) {
          const nextGroup = chinaBoundaryFeatureGroup(data, settings, index);
          const previousGroup = boundaryFeatureGroups[index];
          boundaryFeatureGroups[index] = nextGroup;
          boundaryGroupKeys[index] = groupKey;
          queueBoundaryGroupUpdate(index, source, groupKey, nextGroup, previousGroup);
        }
        const features = boundaryFeatureGroups[index]?.features || [];
        setBoundaryFeatureStates(index, features);
        for (const layer of scopeData.layers.filter((layer) => layer.level !== 'border')) {
          for (const suffix of ['fill', 'line', 'selected-outline']) {
            const overlay = chinaBoundaryLayerId(index, layer.level + '-' + suffix);
            if (map.getLayer(overlay))
              setLayoutProperty(
                overlay,
                'visibility',
                layer.level === level.value ? 'visible' : 'none',
              );
          }
          setPaintProperty(
            chinaBoundaryLayerId(index, layer.level + '-fill'),
            'fill-opacity',
            // Fill translucency is part of the map palette, not basemap
            // visibility. Keep it stable when the basemap is hidden or fails.
            boundaryOverlayFillOpacity(provider.value),
          );
          const highlight = chinaBoundaryLayerId(index, layer.level + '-point-highlight');
          const ids = previewIds(layer.level);
          setFilter(highlight, [
            'all',
            ['==', ['get', 'level'], layer.level],
            ['in', ['get', 'regionId'], ['literal', ids]],
          ]);
          setLayoutProperty(
            highlight,
            'visibility',
            props.pointMode && ids.length ? 'visible' : 'none',
          );
        }
      }
      const lineSettingsKey = (data.fixedPaths || [])
        .flatMap((path) => path.settingKeys || [])
        .map((key) => `${key}:${settings[key] ? 1 : 0}`)
        .join(',');
      const lineKey = lineSettingsKey + ':' + level.value;
      const lines =
        lineKey === boundaryLineKey ? undefined : chinaBoundaryLines(data, settings, level.value);
      const lineSource = map.getSource('china-options-lines') as GeoJSONSource | undefined;
      if (lines) lineSource?.setData(lines);
      if (lines)
        for (const id of [
          'china-options-tanggula-nominal-line',
          'china-options-maritime-dash-line',
        ])
          if (map.getLayer(id))
            setLayoutProperty(id, 'visibility', lines.features.length ? 'visible' : 'none');
      if (lines) boundaryLineKey = lineKey;
      const replaced = chinaBoundaryManagedRegionIds(data);
      for (const l of scopeData.layers.filter((l) => l.level !== 'border')) {
        const filter = [
          '!',
          ['in', ['get', 'regionId'], ['literal', replaced]],
        ] as import('maplibre-gl').ExpressionSpecification;
        const ids = previewIds(l.level);
        setFilter(l.level + '-point-highlight', [
          'all',
          filter,
          ['in', ['get', 'regionId'], ['literal', ids]],
        ]);
        setLayoutProperty(
          l.level + '-point-highlight',
          'visibility',
          props.pointMode && ids.length ? 'visible' : 'none',
        );
      }
    }
    for (const l of scopeData.layers) {
      for (const suffix of ['fill', 'line'])
        if (map.getLayer(l.level + '-' + suffix)) {
          setLayoutProperty(
            l.level + '-' + suffix,
            'visibility',
            l.level === level.value || l.level === 'border' ? 'visible' : 'none',
          );
        }
      if (l.level !== 'border')
        setPaintProperty(l.level + '-fill', 'fill-opacity', boundaryFillOpacity(provider.value));
      const lineColor: import('maplibre-gl').ExpressionSpecification = [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#548774',
        l.level === 'border'
          ? store.dark
            ? '#e2d7ad'
            : '#263f45'
          : store.dark
            ? '#91b0bb'
            : '#8ca49d',
      ];
      setPaintProperty(l.level + '-line', 'line-color', lineColor);
      setPaintProperty(l.level + '-line', 'line-opacity', 1);
      setPaintProperty(l.level + '-line', 'line-width', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        1.5,
        l.level === 'border' ? 2.6 : l.level === 'county' ? 0.5 : 1,
      ]);
      if (l.level !== 'border') {
        const highlight = l.level + '-point-highlight';
        const ids = previewIds(l.level);
        setFilter(highlight, [
          'all',
          ['!', ['in', ['get', 'regionId'], ['literal', replacedIds]]],
          ['in', ['get', 'regionId'], ['literal', ids]],
        ]);
        setLayoutProperty(
          highlight,
          'visibility',
          props.pointMode && ids.length ? 'visible' : 'none',
        );
      }
      if (props.scope === 'china' && scopeData.boundaryOptions && l.level !== 'border')
        for (let index = 0; index < (scopeData.boundaryOptionGroups || 0); index++) {
          setPaintProperty(chinaBoundaryLayerId(index, l.level + '-line'), 'line-color', lineColor);
          setPaintProperty(chinaBoundaryLayerId(index, l.level + '-line'), 'line-opacity', 1);
          setPaintProperty(chinaBoundaryLayerId(index, l.level + '-line'), 'line-width', [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1.5,
            l.level === 'county' ? 0.5 : 1,
          ]);
        }
    }
    for (const r of store.session!.index.catalog.regions) {
      if (r.scope !== props.scope) continue;
      const sourceLevels = sourceLevelsForRegion(r, scopeData, store.session!.index.regions);
      for (const sourceLevel of sourceLevels) {
        if (sourceLevel === 'border') continue;
        setFeatureState(
          { source: sourceLevel, sourceLayer: 'regions', id: r.id },
          {
            fill: fill(r.id),
            selected: selected(r.id),
            recorded: regionRecorded(r.id),
          },
        );
      }
    }
    setPaintProperty('background', 'background-color', store.dark ? '#17272e' : '#eef4f3');
    updateSelectedOutlineFilters(scopeData);
    const nextPointData = pointData();
    const nextPointDataKey = JSON.stringify(
      nextPointData.features.map((feature) => [feature.id, feature.geometry, feature.properties]),
    );
    if (nextPointDataKey !== pointDataKey) {
      (map.getSource('points') as GeoJSONSource).setData(nextPointData);
      pointDataKey = nextPointDataKey;
    }
    const nextVisitedPointData = visitedPointData();
    const nextVisitedPointDataKey = JSON.stringify(
      nextVisitedPointData.features.map((feature) => [
        feature.id,
        feature.geometry,
        feature.properties,
      ]),
    );
    if (nextVisitedPointDataKey !== visitedPointDataKey) {
      (map.getSource('visited-markers') as GeoJSONSource).setData(nextVisitedPointData);
      visitedPointDataKey = nextVisitedPointDataKey;
    }
    pointModeStateInitialized = true;
  }

  function toggleBasemapVisibility() {
    if (!map || !ready) return;
    const visible = basemapEnabled.value && !providerFailed.value;
    for (const layer of map.getStyle().layers) {
      if (layer.id === 'basemap' || layer.id === 'labels' || layer.id.startsWith('base-'))
        setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
    appearance();
  }
  function fitRegion(id = '', duration = 0) {
    if (canvas) {
      canvas.fit(
        id
          ? scene()
              .features.filter((f) => store.session!.index.belongsTo(f.id, id))
              .map((f) => f.id)
          : undefined,
        props.scope === 'china' && store.session!.index.regions.get(id)?.level === 2 ? 0.82 : 1,
        duration,
      );
    }
    const scopeData = manifest.value?.scopes[props.scope];
    if (map && ready && scopeData) {
      const effectiveId = store.session!.index.resolveRegion(id);
      const b = id
        ? (props.scope === 'china' && store.chinaBoundaryData
            ? chinaBoundaryBounds(store.chinaBoundaryData, store.chinaBoundarySettings, effectiveId)
            : undefined) || scopeData.regionBounds[effectiveId]
        : scopeData.bounds;
      const overviewZoom = props.scope === 'singapore' ? 11 : props.scope === 'brunei' ? 8 : 6;
      const detailZoom =
        props.scope === 'china' && level.value === 'county'
          ? 14
          : props.scope === 'france' && level.value === 'county'
            ? 14
            : props.scope === 'france' && level.value === 'city'
              ? 11
              : props.scope === 'singapore'
                ? 12
                : 9;
      if (b)
        map.fitBounds(b, {
          padding: 45,
          maxZoom: id ? detailZoom : overviewZoom,
          duration,
          linear: true,
        });
    }
  }
  function fitSelection(duration = 0) {
    if (props.scope === 'france' && !props.selected && !validCoordinates(props.focus))
      fitFranceView('metropolitan', duration);
    else fitRegion(props.selected, duration);
    // Region fitting establishes a useful fallback before precise point focus.
    if (map && ready && validCoordinates(props.focus)) {
      map.jumpTo({ center: props.focus, zoom: 14 });
    }
  }
  function fitPointFocus(duration = 0) {
    const points = (props.focusPoints || []).filter(validCoordinates);
    if (!points.length && !validCoordinates(props.focus)) return false;
    if (map && ready) map.resize();
    if (points.length > 1) {
      const bounds = points.reduce<Bounds>((box, point) => [
        Math.min(box[0], point[0]), Math.min(box[1], point[1]),
        Math.max(box[2], point[0]), Math.max(box[3], point[1]),
      ], [Infinity, Infinity, -Infinity, -Infinity]);
      if (map && ready) {
        const width = mapHost.value?.clientWidth || 640;
        const height = mapHost.value?.clientHeight || 480;
        const margin = Math.min(72, width * .12, height * .15);
        map.fitBounds(bounds, {
          padding: { top: margin, left: margin, right: Math.min(240, width * .35), bottom: Math.min(128, height * .24) },
          retainPadding: false,
          maxZoom: 16,
          duration,
        });
      } else canvas?.fitCoordinates(points, 16, 96);
    } else {
      const center = points[0] || props.focus!;
      const target = { center, zoom: 15 };
      if (map && ready) map.easeTo({ ...target, duration });
      else canvas?.setCamera(target);
    }
    captureView();
    return true;
  }
  function fitInitialView(camera?: Camera) {
    if (props.pointMode && fitPointFocus()) {
      return;
    } else if (camera) {
      if (map && ready) map.jumpTo(camera);
      else canvas?.setCamera(camera);
    } else if (props.regionMode && !regionAutoFocus.value) {
      if (props.scope === 'france') fitFranceView('metropolitan');
      else fitRegion();
    } else fitSelection();
  }
  function fitFranceView(group: 'metropolitan' | 'overseas', duration = 0) {
    if (props.scope !== 'france') return;
    const ids = store
      .session!.index.catalog.regions.filter(
        (region) => region.scope === 'france' && region.kind?.startsWith(group + '-'),
      )
      .map((region) => region.id);
    if (!ids.length) return;
    if (canvas) canvas.fit(ids, 1, duration);
    const scopeData = manifest.value?.scopes.france;
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
    map.fitBounds(bounds, { padding: 45, maxZoom: 6, duration, linear: true });
  }
  function zoom(factor: number) {
    canvas?.zoom(factor);
    if (map && ready) map.zoomTo(map.getZoom() + Math.log2(factor), { duration: 180 });
  }
  async function exportPng() {
    // Export only our own geometry, independent of provider licensing or raster failures.
    const token = generation;
    const previousGeometry = simple.value;
    let renderer: CanvasMapRenderer | undefined, holder: HTMLElement | undefined;
    try {
      const geometry = simple.value || (await loadSimple(props.scope, level.value));
      if (token !== generation) return;
      simple.value = geometry;
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1600px;height:1000px';
      document.body.append(holder);
      renderer = new CanvasMapRenderer(holder, () => {});
      await new Promise(requestAnimationFrame);
      if (token !== generation) return;
      renderer.setScene(scene(true), true);
      if (props.selected)
        renderer.fit(
          scene()
            .features.filter((f) => selected(f.id))
            .map((f) => f.id),
        );
      const image = await renderer.png(
        '方舆旅行地图',
        Object.entries(VISIT_LABELS).map(([state, label]) => ({
          label,
          color: store.colors[state as keyof typeof VISIT_LABELS],
        })),
        mapAttributions(props.scope, visitedLayers.value.visitedWorldHeritage).map(
          (credit) => `${credit.label} · ${credit.url}`,
        ),
      );
      if (token === generation) download(image, '方舆地图.png');
    } catch {
      if (token === generation) mapError.value = '地图图片暂时无法生成，请重试。';
    } finally {
      if (token === generation) simple.value = previousGeometry;
      renderer?.destroy();
      holder?.remove();
    }
  }
  function initialize() {
    pendingProviderCamera = undefined;
    initialPointsChecked = false;
    return initializeMap(props.initialCamera);
  }
  function changeProvider() {
    // Switching the visual background must not reset a manually chosen viewport.
    if (map && ready)
      pendingProviderCamera = { center: map.getCenter().toArray(), zoom: map.getZoom() };
    else if (canvas && (props.pointMode || props.regionMode))
      pendingProviderCamera = canvas.camera();
    return initializeMap(pendingProviderCamera);
  }
  async function initializeMap(camera?: Camera) {
    const token = ++generation;
    if (props.scope !== 'china') releaseBoundaryLease();
    controller?.abort();
    controller = new AbortController();
    clearTimeout(timer);
    clearDebugMap(map);
    map?.remove();
    canvas?.destroy();
    map = undefined;
    canvas = undefined;
    simple.value = undefined;
    featureStateCache.clear();
    styleValueCache.clear();
    pointDataKey = '';
    visitedPointDataKey = '';
    boundaryLineKey = '';
    boundaryOrdinaryFilterKey = '';
    boundaryFeatureGroups.length = 0;
    boundaryGroupKeys.length = 0;
    boundaryGroupUpdates.length = 0;
    boundaryGroupPendingKeys.length = 0;
    pointModeStateInitialized = false;
    lastPointMode = undefined;
    lastCategoryColorMode = undefined;
    closeVisitedSelection();
    manifest.value = undefined;
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
      manifest.value = nextManifest;
      const scopeData = manifest.value.scopes[props.scope];
      if (props.scope !== 'china' || !scopeData?.boundaryOptions) releaseBoundaryLease();
      if (!scopeData) {
        missingBoundary.value = true;
        loading.value = false;
        mapError.value = '该专题尚无已发布的边界地图，地点列表与已有记录仍可使用。';
        return;
      }
      if (token !== generation || !mapHost.value) return;
      const runtime = await import('./tile-runtime.js');
      if (token !== generation || !mapHost.value) return;
      map = new runtime.LibreMap({
        container: mapHost.value,
        style: createMapStyle(
          manifest.value,
          props.scope,
          level.value,
          provider.value,
          base,
          location.href,
          Boolean(props.pointMode),
        ),
        bounds: scopeData.bounds,
        fitBoundsOptions: { padding: 45 },
        attributionControl: false,
        renderWorldCopies: false,
        maxZoom: 20,
        dragRotate: false,
        touchPitch: false,
      });
      const current = map;
      if (import.meta.env.DEV && mapDebugRequested())
        (globalThis as typeof globalThis & { __fangyuMap?: LibreMap }).__fangyuMap = current;
      // MapLibre 6 resolves image dependencies before emitting styleimagemissing.
      // Supply dynamic count images in its awaited resolver so the same worker
      // request receives them; adding them in that later event misses this tile.
      current.setMissingStyleImageResolver((id) => {
        if (token !== generation || current !== map) return;
        addSelectedRegionHatch(current);
        addVisitedImage(current, id);
      });
      timer = setTimeout(() => {
        if (token !== generation || !loading.value) return;
        // Online labels may arrive slowly; a ready vector map remains usable.
        if (ready) loading.value = false;
        else void useFallback(token);
      }, 15000);
      current.on('style.load', () => {
        if (token !== generation || current !== map) return;
        ready = true;
        addSelectedRegionHatch(current);
        for (const kind of ['airport', 'world-heritage', 'project-reference'])
          addVisitedImage(current, 'visited-' + kind);
        appearance();
        toggleBasemapVisibility();
        fitInitialView(camera);
        mapZoom.value = current.getZoom();
        mapCenter.value = current.getCenter().toArray();
        captureView();
        revealInitialPoints();
        if (
          props.scope === 'china' &&
          scopeData.boundaryOptions
        ) {
          void acquireBoundaryLease()
            .then(() => {
              if (token === generation && current === map) {
                pointModeStateInitialized = false;
                appearance();
              } else if (disposed || props.scope !== 'china') releaseBoundaryLease();
            })
            .catch(() => {
              if (token === generation && current === map)
                mapError.value = '特殊政区边界暂时无法加载，基础地图与点位仍可使用。';
            });
        }
      });
      current.on('move', () => {
        if (props.pointMode) captureView();
      });
      current.on('moveend', () => {
        if (token === generation && current === map) {
          mapZoom.value = current.getZoom();
          mapCenter.value = current.getCenter().toArray();
          captureView();
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
        if (sourceId === 'basemap' || sourceId === 'labels' || sourceId?.startsWith('base-')) {
          providerFailed.value = true;
          for (const layer of current.getStyle().layers)
            if (['basemap', 'labels'].includes(layer.id) || layer.id.startsWith('base-'))
              current.removeLayer(layer.id);
          for (const id of Object.keys(current.getStyle().sources).filter(
            (id) => ['basemap', 'labels'].includes(id) || id.startsWith('base-'),
          ))
            if (current.getSource(id)) current.removeSource(id);
          appearance();
        } else if (sourceId && scopeData.layers.some((layer) => layer.level === sourceId)) {
          // SharedPromiseCache retains failed header/directory promises. Several
          // sources may fail together, while only the first error reaches this
          // handler before fallback removes the map. Renew this scope's readers.
          for (const failed of scopeData.layers)
            if (failed.archive) runtime.renewArchive(base, failed.url, location.href);
          void useFallback(token);
        } else if (ready) {
          mapError.value = '地图资源暂时无法完整加载，政区列表与已有记录仍可使用。';
          loading.value = false;
          clearTimeout(timer);
        } else void useFallback(token);
      });
      current.on('webglcontextlost', () => {
        if (token === generation) void useFallback(token);
      });
      bindInteractions(current);
      current.getCanvas().addEventListener('mouseleave', () => (hovered.value = undefined), {
        signal: controller.signal,
      });
    } catch (error) {
      void error;
      if (token === generation) await useFallback(token);
    }
  }
  onMounted(() => {
    observer = new ResizeObserver(() => {
      if (mapHost.value?.clientWidth && mapHost.value?.clientHeight) map?.resize();
      captureView();
    });
    if (mapHost.value) observer.observe(mapHost.value);
    void initialize();
  });
  onBeforeUnmount(() => {
    disposed = true;
    captureView();
    generation++;
    controller?.abort();
    clearTimeout(timer);
    observer?.disconnect();
    clearDebugMap(map);
    map?.remove();
    canvas?.destroy();
    map = undefined;
    canvas = undefined;
    ready = false;
    closeVisitedSelection();
    releaseBoundaryLease();
  });
  watch(() => props.scope, initialize);
  watch(basemapKind, changeProvider);
  watch(basemapEnabled, toggleBasemapVisibility);
  watch(
    () => [
      store.revision,
      store.dark,
      props.category,
      props.level,
      props.selected,
      props.previewRegions,
      props.pointMode,
      props.regionMode,
      props.selectionMuted,
    ],
    appearance,
  );
  watch(
    () => [props.selected, props.level, props.focus, props.focusPoints, JSON.stringify(store.chinaBoundarySettings)],
    ([selectedId, , , , settingsKey], [previousSelectedId, , , , previousSettingsKey]) => {
      if (selectedId !== previousSelectedId && settingsKey !== previousSettingsKey) {
        captureView();
        return;
      }
      if (props.pointMode) {
        fitPointFocus(650);
        return;
      }
      if (!props.regionMode || regionAutoFocus.value) {
        // Fit against the available map space after the details panel opens.
        if (props.regionMode) map?.resize();
        fitSelection(props.regionMode ? 650 : 0);
      }
      captureView();
    },
    { flush: 'post' },
  );
  watch(regionAutoFocus, (enabled) => {
    if (props.regionMode && !enabled) {
      map?.stop();
      canvas?.stop();
      captureView();
    }
  });
  watch(visiblePoints, () => {
    appearance();
    revealInitialPoints();
  });
  watch(visitedResult, appearance);
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
    providerFailed,
    missingBoundary,
    mapZoom,
    mapCenter,
    visiblePointCount,
    pointGroups,
    expandCluster,
    visitedResult,
    visitedLayers,
    selectedVisitedMarkers,
    selectVisitedMarker,
    closeVisitedSelection,
    initialize,
    useFallback: () => useFallback(),
    zoom,
    fitRegion,
    fitSelection: () => fitSelection(props.regionMode ? 650 : 0),
    fitFranceView,
    exportPng,
  };
}
