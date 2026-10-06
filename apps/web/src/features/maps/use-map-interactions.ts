import { computed, ref, watch, type Ref } from 'vue';
import type { Map as LibreMap, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import {
  drawVisitedMarker,
  drawVisitedCluster,
  type CanvasMapRenderer,
  type VisitedMarkerKind,
} from '@fangyu/map-renderer';
import type { VisitedMapMarker } from '@fangyu/domain';
import { useAppStore } from '../../app/store.js';
import { VISITED_MARKER_LAYER_IDS } from './style.js';
import { regionInteractionPolicy } from './sea-region-interaction.js';
import type { TiledMapProps } from './types.js';
import type { useMapScene } from './use-map-scene.js';

interface InteractionResources {
  map: () => LibreMap | undefined;
  canvas: () => CanvasMapRenderer | undefined;
  ready: () => boolean;
}
export function useMapInteractions(
  props: TiledMapProps,
  level: Ref<string>,
  drawing: ReturnType<typeof useMapScene>,
  resources: InteractionResources,
  select: (id: string, point: boolean) => void,
) {
  const store = useAppStore();
  const { hovered, visitedById, visitedResult } = drawing;
  let visitedSelectionRequest = 0;
  const selectedVisitedIds = ref<string[]>([]);
  const selectedVisitedMarkers = computed(() =>
    selectedVisitedIds.value
      .map((id) => visitedById.value.get(id))
      .filter((marker): marker is VisitedMapMarker => Boolean(marker)),
  );

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
    if (resources.ready())
      resources.map()?.easeTo({
        center: marker.coordinates,
        zoom: marker.kind === 'project-reference' ? 7 : 14,
        duration: 250,
      });
    resources.canvas()?.focusPoints([id], marker.kind === 'project-reference' ? 2 : 24);
  }
  function selectCanvasMarkers(ids: string[]) {
    visitedSelectionRequest++;
    showVisitedSelection(ids);
    if (selectedVisitedMarkers.value.length)
      resources
        .canvas()
        ?.focusPoints(
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
    const request = ++visitedSelectionRequest;
    const source = current.getSource('visited-markers') as GeoJSONSource;
    try {
      const leaves = await source.getClusterLeaves(
        Number(feature.properties.cluster_id),
        Number(feature.properties.point_count),
        0,
      );
      if (current !== resources.map() || request !== visitedSelectionRequest) return;
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
      if (current !== resources.map() || request !== visitedSelectionRequest) return;
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

  function bindInteractions(current: LibreMap) {
    current.on('click', (e) => {
      if (!resources.ready() || current !== resources.map()) return;
      // Point exploration handles point clicks in its independent DOM overlay.
      if (props.pointMode) return;
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
      if (!resources.ready() || current !== resources.map()) return;
      if (props.pointMode) {
        hovered.value = undefined;
        current.getCanvas().style.cursor = '';
        return;
      }
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
  }
  watch(visitedResult, () => {
    visitedSelectionRequest++;
    selectedVisitedIds.value = selectedVisitedIds.value.filter((id) => visitedById.value.has(id));
    if (hovered.value?.markerIds || hovered.value?.markerCount) hovered.value = undefined;
  });
  watch(() => props.scope, closeVisitedSelection);
  return {
    selectedVisitedMarkers,
    selectVisitedMarker,
    closeVisitedSelection,
    selectCanvasMarkers,
    addVisitedImage,
    bindInteractions,
  };
}
