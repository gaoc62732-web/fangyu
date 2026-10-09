import { computed, ref, type Ref } from 'vue';
import { VISIT_LABELS } from '@fangyu/contracts';
import {
  visitedMapMarkers,
  drawablePoint,
  type VerifiedVisitedMapAssociation,
} from '@fangyu/domain';
import type { MapScene, MapHover } from '@fangyu/map-renderer';
import { useAppStore } from '../../app/store.js';
import { validCoordinates } from './map-coordinates.js';
import { regionInteractionPolicy } from './sea-region-interaction.js';
import type { TiledMapProps } from './types.js';
import airportAssociations from '../../../../../data/extensions/research/china-airport-map-associations.json';
import { applyChinaBoundaries } from './china-boundaries.js';

export function useMapScene(
  props: TiledMapProps,
  host: Ref<HTMLElement | undefined>,
  mapZoom: Ref<number>,
  level: Ref<string>,
  simple: Ref<GeoJSON.FeatureCollection | undefined>,
  featureBounds: (id: string) => [number, number, number, number] | undefined = () => undefined,
) {
  const store = useAppStore();
  const hovered = ref<MapHover>();
  const showPoints = ref(true);
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
      layers:
        props.pointMode || props.regionMode
          ? { visitedAirports: false, visitedWorldHeritage: false }
          : visitedLayers.value,
      associations: airportAssociations.associations as VerifiedVisitedMapAssociation[],
    });
  });
  const visitedById = computed(
    () => new Map(visitedResult.value.markers.map((marker) => [marker.id, marker])),
  );

  const visiblePoints = computed(() =>
    !showPoints.value
      ? []
      : props.pointMode
        ? (props.points || []).filter(drawablePoint)
        : (props.points || []).filter(
            (e) =>
              validCoordinates(e.coordinates) &&
              !visitedById.value.has(e.recordId) &&
              !e.coordinateStatus?.includes('representative') &&
              (e.visited || mapZoom.value >= 7 || props.category || props.selected || props.focus),
          ),
  );
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
    if (props.pointMode) return 'transparent';
    const region = store.session!.index.regions.get(id);
    return region
      ? store.colors[
          !props.pointMode && props.category && props.scope === 'china'
            ? categoryRegions.value.has(id)
              ? 'arrived'
              : 'unvisited'
            : store.session!.visitState(id)
        ]
      : store.colors.unmapped;
  }
  // Render exact association geometry, including holes and disconnected polygons.
  // A selected parent already covers its children: do not darken overlaps twice.
  const previewTargets = computed(() => {
    void store.revision;
    const ids = [
      ...new Set((props.previewRegions || []).map((id) => store.session!.index.resolveRegion(id))),
    ].filter((id) => store.session!.index.regions.get(id)?.scope === props.scope);
    return ids.filter(
      (id) => !ids.some((parent) => parent !== id && store.session!.index.belongsTo(id, parent)),
    );
  });
  function previewLevel(id: string) {
    return props.scope === 'china' || props.scope === 'france'
      ? ['province', 'city', 'county'][store.session!.index.regions.get(id)?.level ?? -1]
      : level.value;
  }
  const previewIds = (layer: string) =>
    previewTargets.value.filter((id) => previewLevel(id) === layer);
  const selected = (id: string) =>
    props.pointMode
      ? previewTargets.value.includes(id)
      : Boolean(
          (props.previewRegions !== undefined ? props.previewRegions : [props.selected]).some(
            (target) =>
              target &&
              (store.session!.index.belongsTo(id, target) ||
                (props.previewRegions !== undefined && store.session!.index.belongsTo(target, id))),
          ),
        );
  const hoverInfo = computed(() => {
    const hit = hovered.value;
    if (!hit || (props.pointMode && !hit.point)) return;
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
  function scene(includePointOverlay = false): MapScene {
    const collection =
      simple.value && props.scope === 'china' && store.chinaBoundaryData
        ? applyChinaBoundaries(
            simple.value,
            store.chinaBoundaryData,
            store.chinaBoundarySettings,
            props.level,
          )
        : simple.value;
    return {
      pointExploration: Boolean(props.pointMode),
      world: props.scope === 'world',
      dark: store.dark,
      allowsRegionHit: regionInteractionPolicy(props.scope),
      detailLevel: props.scope === 'china' && props.level !== 'country' ? props.level : undefined,
      features: (collection?.features || [])
        .filter((f) => {
          if (props.scope !== 'china' || f.properties?.level !== 'county') return true;
          const region = store.session!.index.regions.get(String(f.properties?.regionId || f.id));
          return region && (region.level === 2 || ['810000', '820000'].includes(region.code));
        })
        .filter(
          (f) =>
            f.properties?.level === level.value ||
            (props.pointMode &&
              previewIds(String(f.properties?.level)).includes(
                String(f.properties?.regionId || f.id),
              )) ||
            (f.properties?.level === 'border' &&
              ['LineString', 'MultiLineString'].includes(f.geometry.type) &&
              (props.scope !== 'china' ||
                ['land', 'maritime-dash', 'tanggula-nominal'].includes(
                  f.properties?.boundaryKind,
                ))),
        )
        .map((f) => {
          const id = String(
            f.properties?.level === 'border' ? f.id : f.properties?.regionId || f.id,
          );
          return {
            id,
            name: String(f.properties?.name || ''),
            geometry: f.geometry,
            ...(featureBounds(id) ? { bounds: featureBounds(id) } : {}),
            fill: f.properties?.level === 'border' ? 'transparent' : fill(id),
            selected: props.pointMode
              ? selected(id) && f.properties?.level === previewLevel(id)
              : selected(id),
            interactive:
              !props.pointMode &&
              f.properties?.level !== 'border' &&
              store.session!.index.regions.has(id),
            boundary: f.properties?.level === level.value || f.properties?.level === 'border',
            dashed: f.properties?.boundaryKind === 'tanggula-nominal',
          };
        }),
      points: [
        ...(props.pointMode && !includePointOverlay ? [] : visiblePoints.value).map((e) => ({
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
      features: (props.pointMode ? [] : visiblePoints.value).map((e) => ({
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

  return {
    hovered,
    showPoints,
    visitedLayers,
    visitedResult,
    visitedById,
    visiblePoints,
    visiblePointCount,
    categoryRegions,
    fill,
    selected,
    previewTargets,
    previewIds,
    hoverInfo,
    hoverStyle,
    scene,
    pointData,
    visitedPointData,
  };
}
