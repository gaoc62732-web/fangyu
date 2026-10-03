import type { VisitedMarkerKind } from './visited-marker-icons.js';

export interface RenderFeature {
  id: string;
  name: string;
  geometry: GeoJSON.Geometry;
  fill: string;
  selected?: boolean;
  interactive?: boolean;
}

export interface RenderPoint {
  id: string;
  name: string;
  coords: [number, number];
  marked: boolean;
  markerKind?: VisitedMarkerKind | undefined;
}

export interface MapScene {
  features: RenderFeature[];
  points: RenderPoint[];
  /** Optional geographic hit policy for administrative polygons only; points remain selectable. */
  allowsRegionHit?:
    ((coordinates: [number, number], renderedGeometry?: GeoJSON.Geometry) => boolean) | undefined;
  world?: boolean;
  dark?: boolean;
  detailLevel?: 'province' | 'city' | 'county' | undefined;
}
