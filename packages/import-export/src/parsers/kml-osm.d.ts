import type { GeographicItem } from '@fangyu/contracts';

export interface KmlDocument {
  items: GeographicItem[];
  vertices: number;
  unsupported: number;
  placemarks: number;
}
export interface OsmDocument {
  features: GeographicItem[];
  rawNodes: number;
  rawWays: number;
  rawRelations: number;
  missingRefs: number;
  unsupported: number;
}
export function parseKml(text: string): KmlDocument;
export function parseOsm(text: string): OsmDocument;
