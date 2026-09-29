import type { Geometry } from 'geojson';
export type Scope = 'china' | 'world' | 'japan' | 'korea';
export type MapLevel = 'province' | 'city' | 'county' | 'country';

export interface Region {
  id: string;
  parentId: string | null;
  scope: Scope;
  level: number;
  name: string;
  code: string;
  historical: boolean;
  aliases: string[];
}

export interface Subitem {
  id: string;
  name: string;
}

export interface CatalogEntry {
  id: string;
  recordId: string;
  scope: Scope;
  regionIds: string[];
  categoryId: string;
  name: string;
  aliases: string[];
  subitems: Subitem[];
  coordinates?: [number, number] | null;
  source?: string;
  description?: string;
  code?: string;
  countryCode?: string;
  linkedRegionId?: string;
  topicRegions?: Partial<Record<Scope, string[]>>;
  heritageType?: string;
  multinational?: boolean;
  year?: string;
  lines?: string[];
  operators?: string[];
  railTypes?: string;
}

export interface GeometryFeature {
  id: string;
  regionId: string | null;
  level: MapLevel | 'border';
  geometry: Geometry;
}

export interface Catalog {
  version: string;
  categories: { id: string; name: string }[];
  regions: Region[];
  entries: CatalogEntry[];
  achievements: {
    definitions: AchievementDefinition[];
    quantityRegionIds: string[];
  };
  sources: unknown[];
}

export interface Condition {
  mode: 'any' | 'all' | 'minimum';
  regionIds?: string[];
  entryIds?: string[];
  conditions?: Condition[];
  minimum?: number;
  inferAncestors?: boolean;
  fullMark?: boolean;
}
export interface AchievementDefinition {
  id: string;
  title: string;
  section: string;
  note: string;
  pending: string[];
  sources: (string | { title: string; url: string })[];
  steps?: number[] | null;
  need?: number;
  catalogComplete?: boolean;
  targets: { label: string; regionIds: string[]; condition: Condition }[];
}
