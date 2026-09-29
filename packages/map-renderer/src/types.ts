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
}

export interface MapScene {
  features: RenderFeature[];
  points: RenderPoint[];
  world?: boolean;
  dark?: boolean;
  detailLevel?: 'province' | 'city' | 'county' | undefined;
}
