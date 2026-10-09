import { computed, shallowRef, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl';
import { VISIT_LABELS, getScopeConfig, type Scope } from '@fangyu/contracts';
import { CanvasMapRenderer, clusterScreenMarkers } from '@fangyu/map-renderer';
import { useAppStore } from '../../app/store.js';
import { download } from '../exports/download.js';
import { type Bounds, type MapDataManifest } from './types.js';
import { basemapProvider } from './basemap-settings.js';
import { mapAttributions } from './data-attribution.js';
import { boundaryFillOpacity, createMapStyle } from './style.js';
import type { TiledMapProps } from './types.js';
import { validCoordinates } from './map-coordinates.js';
import { useMapScene } from './use-map-scene.js';
import { useMapInteractions } from './use-map-interactions.js';
import {
  chinaBoundaryFeatureDiff,
  chinaBoundaryFeatureGroup,
  chinaBoundaryLayerId,
  chinaBoundarySourceId,
  chinaBoundaryLines,
  chinaBoundaryBounds,
} from './china-boundaries.js';
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
  // Point mode keeps the basemap already in use when entering the page.
  const existingBasemap = basemapProvider.value;
  const provider = computed(() => (props.pointMode ? existingBasemap : basemapProvider.value));
  const regionAutoFocus = computed(() => {
    void store.revision;
    return store.session!.preferences.regionAutoFocus !== false;
  });
  let map: LibreMap | undefined, canvas: CanvasMapRenderer | undefined;
  const manifest = shallowRef<MapDataManifest>();
  const simple = shallowRef<GeoJSON.FeatureCollection>();
  let generation = 0,
    ready = false,
    fallingBack = false;
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
  const pointGroups = computed(() => {
    void viewportRevision.value;
    if (!props.pointMode) return [];
    const width = mapHost.value?.clientWidth || 0,
      height = mapHost.value?.clientHeight || 0;
    return clusterScreenMarkers(
      visiblePoints.value.flatMap((entry) => {
        const p = projectPoint(entry.coordinates!);
        return p && p[0] >= -24 && p[0] <= width + 24 && p[1] >= -24 && p[1] <= height + 24
          ? [{ id: entry.id, x: p[0], y: p[1], value: entry }]
          : [];
      }),
      32,
    );
  });
  function revealInitialPoints() {
    if (!props.pointMode || initialPointsChecked) return;
    initialPointsChecked = true;
    const points = visiblePoints.value;
    if (!points.length || pointGroups.value.length) return;
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
  function expandCluster(ids: string[]) {
    const members = visiblePoints.value.filter((e) => ids.includes(e.id));
    if (!members.length) return;
    const center: [number, number] = [
      members.reduce((sum, e) => sum + e.coordinates![0], 0) / members.length,
      members.reduce((sum, e) => sum + e.coordinates![1], 0) / members.length,
    ];
    if (map && ready)
      map.easeTo({ center, zoom: Math.min(15, map.getZoom() + 1.5), duration: 250 });
    else if (canvas) canvas.setCamera({ center, zoom: Math.min(15, mapZoom.value + 1.5) });
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
  const {
    selectedVisitedMarkers,
    selectVisitedMarker,
    closeVisitedSelection,
    selectCanvasMarkers,
    addVisitedImage,
    bindInteractions,
  } = useMapInteractions(
    props,
    level,
    drawing,
    {
      map: () => map,
      canvas: () => canvas,
      ready: () => ready,
    },
    select,
  );
  let boundaryLease: { release: () => void } | undefined;
  let boundaryLeaseRequest: Promise<void> | undefined;
  const boundaryFeatureGroups: (GeoJSON.FeatureCollection | undefined)[] = [];
  const boundaryGroupKeys: string[] = [];
  const boundaryGroupReady: Promise<void>[] = [];
  const featureStateCache = new Map<string, Record<string, string | boolean>>();
  const styleValueCache = new Map<string, string>();
  let pointDataKey = '';
  let visitedPointDataKey = '';
  let boundaryLineKey = '';
  let boundaryOrdinaryFilterKey = '';
  function setLayoutProperty(layer: string, property: string, value: unknown) {
    if (!map) return;
    const key = `layout:${layer}:${property}`;
    const serialized = JSON.stringify(value) ?? 'undefined';
    if (styleValueCache.get(key) === serialized) return;
    map.setLayoutProperty(layer, property as never, value as never);
    styleValueCache.set(key, serialized);
  }
  function setPaintProperty(layer: string, property: string, value: unknown) {
    if (!map) return;
    const key = `paint:${layer}:${property}`;
    const serialized = JSON.stringify(value) ?? 'undefined';
    if (styleValueCache.get(key) === serialized) return;
    map.setPaintProperty(layer, property as never, value as never);
    styleValueCache.set(key, serialized);
  }
  function setFilter(layer: string, value: import('maplibre-gl').FilterSpecification) {
    if (!map) return;
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
    const changed = Object.fromEntries(
      Object.entries(state).filter(([property, value]) => previous?.[property] !== value),
    );
    if (Object.keys(changed).length) map.setFeatureState(target, changed);
    featureStateCache.set(key, state);
  }
  function sourceLevelForRegion(
    region: { level: number; code: string },
    scopeData: MapDataManifest['scopes'][Scope],
  ) {
    const available = new Set(scopeData.layers.map((layer) => layer.level));
    if (available.has('city') || available.has('county')) {
      if (region.level === 0) return 'province';
      if (region.level === 1) return 'city';
      if (region.level === 2 || ['810000', '820000'].includes(region.code)) return 'county';
      return undefined;
    }
    return scopeData.layers.find((layer) => layer.level !== 'border')?.level;
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
    boundaryGroupReady.length = 0;
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
    const camera =
      props.pointMode || props.regionMode
        ? map && ready
          ? { center: map.getCenter().toArray(), zoom: map.getZoom() }
          : pendingProviderCamera || props.initialCamera
        : undefined;
    clearTimeout(timer);
    clearDebugMap(map);
    map?.remove();
    map = undefined;
    ready = false;
    loading.value = true;
    try {
      const geometry = await loadSimple(
        props.scope,
        props.scope === 'china' ? props.level : undefined,
      );
      if (token !== generation || !mapHost.value) return;
      simple.value = geometry;
      fallback.value = true;
      canvas = new CanvasMapRenderer(
        mapHost.value,
        (id, point, markerIds) => {
          if (token === generation && (!props.pointMode || point))
            markerIds ? selectCanvasMarkers(markerIds) : select(id, point);
        },
        (hit) => {
          if (token === generation)
            hovered.value = props.pointMode && !hit?.point ? undefined : hit;
        },
        captureView,
      );
      canvas.setScene(scene(), true);
      fitInitialView(camera);
      captureView();
      revealInitialPoints();
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
    const scopeData = manifest.value?.scopes[props.scope];
    if (!map || !ready || !scopeData) return;
    const countyIds = store
      .session!.index.catalog.regions.filter(
        (r) => r.scope === 'china' && (r.level === 2 || ['810000', '820000'].includes(r.code)),
      )
      .map((r) => r.id);
    const replacedIds =
      props.scope === 'china' && store.chinaBoundaryData
        ? store.chinaBoundaryData.groups.flatMap((group) => group.regionIds)
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
      for (let index = 0; index < data.groups.length; index++) {
        const group = data.groups[index]!;
        const sourceId = chinaBoundarySourceId(index);
        const source = map.getSource(sourceId) as GeoJSONSource | undefined;
        if (!source) continue;
        const groupKey = group.keys.map((key) => (settings[key] ? '1' : '0')).join('');
        if (groupKey !== boundaryGroupKeys[index]) {
          const nextGroup = chinaBoundaryFeatureGroup(data, settings, index);
          const previousGroup = boundaryFeatureGroups[index];
          const diff = previousGroup
            ? chinaBoundaryFeatureDiff(previousGroup, nextGroup)
            : undefined;
          const changedIds = diff
            ? new Set([
                ...diff.add.map((feature) => String(feature.id)),
                ...diff.update.map((feature) => feature.id),
              ])
            : new Set(nextGroup.features.map((feature) => String(feature.id)));
          if (diff) {
            for (const id of diff.remove) {
              map.removeFeatureState({ source: sourceId, id });
              featureStateCache.delete([sourceId, '', id].join('\0'));
            }
            for (const id of changedIds) featureStateCache.delete([sourceId, '', id].join('\0'));
          }
          const update = () => {
            if (!diff) return source.setData(nextGroup);
            if (!diff.remove.length && !diff.add.length && !diff.update.length)
              return Promise.resolve();
            return source.updateData(diff);
          };
          const refreshChangedState = () => {
            for (const feature of nextGroup.features) {
              const id = String(feature.id);
              if (!changedIds.has(id)) continue;
              featureStateCache.delete([sourceId, '', id].join('\0'));
              setFeatureState(
                { source: sourceId, id },
                {
                  fill: fill(id),
                  selected: selected(id),
                  recorded:
                    props.category && props.scope === 'china'
                      ? categoryRegions.value.has(id)
                      : store.session!.visitState(id) !== 'unvisited',
                },
              );
            }
          };
          boundaryGroupReady[index] = (boundaryGroupReady[index] || Promise.resolve())
            .then(update)
            .catch(() => source.setData(nextGroup))
            .then(refreshChangedState)
            .then(
              () => undefined,
              () => undefined,
            );
          boundaryFeatureGroups[index] = nextGroup;
          boundaryGroupKeys[index] = groupKey;
        }
        const features = boundaryFeatureGroups[index]?.features || [];
        for (const f of features) {
          const id = String(f.id);
          setFeatureState(
            { source: sourceId, id },
            {
              fill: fill(id),
              selected: selected(id),
              recorded:
                props.category && props.scope === 'china'
                  ? categoryRegions.value.has(id)
                  : store.session!.visitState(id) !== 'unvisited',
            },
          );
        }
        for (const layer of scopeData.layers.filter((layer) => layer.level !== 'border')) {
          for (const suffix of ['fill', 'line']) {
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
            props.pointMode ? 0 : boundaryFillOpacity(providerFailed.value ? null : provider.value),
          );
          if (props.pointMode) {
            const highlight = chinaBoundaryLayerId(index, layer.level + '-point-highlight');
            const ids = previewIds(layer.level);
            setFilter(highlight, [
              'all',
              ['==', ['get', 'level'], layer.level],
              ['in', ['get', 'regionId'], ['literal', ids]],
            ]);
            setLayoutProperty(highlight, 'visibility', ids.length ? 'visible' : 'none');
          }
        }
      }
      const lineSettingsKey = (data.lineGroups || [])
        .flatMap((group) => group.keys)
        .map((key) => `${key}:${settings[key] ? 1 : 0}`)
        .join(',');
      const lineKey = lineSettingsKey + ':' + level.value;
      const lines =
        lineKey === boundaryLineKey ? undefined : chinaBoundaryLines(data, settings, level.value);
      const lineSource = map.getSource('china-options-lines') as GeoJSONSource | undefined;
      if (lines) lineSource?.setData(lines);
      if (lines && map.getLayer('china-options-tanggula-nominal-line'))
        setLayoutProperty(
          'china-options-tanggula-nominal-line',
          'visibility',
          lines.features.length ? 'visible' : 'none',
        );
      if (lines) boundaryLineKey = lineKey;
      const replaced = data.groups.flatMap((group) => group.regionIds);
      for (const l of scopeData.layers.filter((l) => l.level !== 'border')) {
        const filter = [
          '!',
          ['in', ['get', 'regionId'], ['literal', replaced]],
        ] as import('maplibre-gl').ExpressionSpecification;
        if (props.pointMode) {
          const ids = previewIds(l.level);
          setFilter(l.level + '-point-highlight', [
            'all',
            filter,
            ['in', ['get', 'regionId'], ['literal', ids]],
          ]);
        }
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
        setPaintProperty(
          l.level + '-fill',
          'fill-opacity',
          props.pointMode ? 0 : boundaryFillOpacity(providerFailed.value ? null : provider.value),
        );
      if (props.pointMode) {
        if (l.level !== 'border') {
          const highlight = l.level + '-point-highlight';
          const ids = previewIds(l.level);
          const replaced =
            props.scope === 'china' && store.chinaBoundaryData
              ? store.chinaBoundaryData.groups.flatMap((group) => group.regionIds)
              : [];
          setFilter(highlight, [
            'all',
            ['!', ['in', ['get', 'regionId'], ['literal', replaced]]],
            ['in', ['get', 'regionId'], ['literal', ids]],
          ]);
          setLayoutProperty(highlight, 'visibility', ids.length ? 'visible' : 'none');
        }
        continue;
      }
      const lineColor: import('maplibre-gl').ExpressionSpecification = [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#cf762b',
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
      if (props.scope === 'china' && scopeData.boundaryOptions && l.level !== 'border')
        for (let index = 0; index < (scopeData.boundaryOptionGroups || 0); index++)
          setPaintProperty(chinaBoundaryLayerId(index, l.level + '-line'), 'line-color', lineColor);
    }
    for (const r of store.session!.index.catalog.regions) {
      if (r.scope !== props.scope) continue;
      const sourceLevel = sourceLevelForRegion(r, scopeData);
      if (!sourceLevel || sourceLevel === 'border') continue;
      setFeatureState(
        { source: sourceLevel, sourceLayer: 'regions', id: r.id },
        {
          fill: fill(r.id),
          selected: selected(r.id),
          recorded:
            !props.pointMode && props.category && props.scope === 'china'
              ? categoryRegions.value.has(r.id)
              : store.session!.visitState(r.id) !== 'unvisited',
        },
      );
    }
    setPaintProperty('background', 'background-color', store.dark ? '#17272e' : '#eef4f3');
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
  function fitInitialView(camera?: Camera) {
    if (camera) {
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
    boundaryGroupReady.length = 0;
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
      if (props.scope === 'china' && scopeData?.boundaryOptions) await acquireBoundaryLease();
      else releaseBoundaryLease();
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
        attributionControl: { compact: true },
        renderWorldCopies: false,
        maxZoom: 15,
        dragRotate: false,
        touchPitch: false,
      });
      const current = map;
      if (import.meta.env.DEV && new URLSearchParams(location.search).has('mapDebug'))
        (globalThis as typeof globalThis & { __fangyuMap?: LibreMap }).__fangyuMap = current;
      // MapLibre 6 resolves image dependencies before emitting styleimagemissing.
      // Supply dynamic count images in its awaited resolver so the same worker
      // request receives them; adding them in that later event misses this tile.
      current.setMissingStyleImageResolver((id) => {
        if (token === generation && current === map) addVisitedImage(current, id);
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
        for (const kind of ['airport', 'world-heritage', 'project-reference'])
          addVisitedImage(current, 'visited-' + kind);
        appearance();
        fitInitialView(camera);
        mapZoom.value = current.getZoom();
        mapCenter.value = current.getCenter().toArray();
        captureView();
        revealInitialPoints();
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
          mapError.value = '地图资源暂时无法完整加载，可切换简化地图。';
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
    } catch {
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
  watch(provider, changeProvider);
  watch(
    () => [
      store.revision,
      store.dark,
      props.category,
      props.level,
      props.selected,
      props.previewRegions,
    ],
    appearance,
  );
  watch(
    () => [props.selected, props.level, props.focus],
    () => {
      if (props.pointMode) return;
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
  watch(visiblePoints, appearance);
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
