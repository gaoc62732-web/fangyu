import type { VisitedMarkerKind } from './visited-marker-icons.js';

export interface RenderFeature {
  id: string;
  name: string;
  geometry: GeoJSON.Geometry;
  /** Geographic [west, south, east, north] bounds when supplied by the data manifest. */
  bounds?: [number, number, number, number] | undefined;
  fill: string;
  selected?: boolean;
  interactive?: boolean;
  /** Preview geometry from another administrative level may fill without adding boundaries. */
  boundary?: boolean;
  /** Reference boundaries are drawn as noninteractive dashed lines. */
  dashed?: boolean;
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
  /** Point exploration uses the same detailed zoom range as the tile map. */
  pointExploration?: boolean;
  /** Optional geographic hit policy for administrative polygons only; points remain selectable. */
  allowsRegionHit?:
    ((coordinates: [number, number], renderedGeometry?: GeoJSON.Geometry) => boolean) | undefined;
  world?: boolean;
  dark?: boolean;
  detailLevel?: 'province' | 'city' | 'county' | undefined;
}
