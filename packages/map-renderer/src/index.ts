export type { RenderFeature, RenderPoint, MapScene } from './types.js';
export { POINT_MAP_APPEARANCE, pointVisitColors } from './point-map-appearance.js';
export { CanvasMapRenderer, type MapHover } from './canvas-renderer.js';
export { clusterScreenMarkers, type ScreenMarkerCluster } from './marker-clusters.js';
export { geographicClusters, type GeographicMarker, type GeographicMarkerCluster } from './geographic-clusters.js';
export {
  VISITED_MARKER_PATHS,
  drawVisitedMarker,
  drawVisitedCluster,
  type VisitedMarkerKind,
} from './visited-marker-icons.js';
