import type { Geometry } from 'geojson';
import type { Scope } from './scopes.js';
import type { HeritageProject } from './heritage.js';
export type { Scope } from './scopes.js';
export type MapLevel = 'province' | 'city' | 'county' | 'country';

export interface Region {
  id: string;
  parentId: string | null;
  scope: Scope;
  level: number;
  name: string;
  nameZh?: string;
  nameEn?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
  originalName?: string;
  code: string;
  historical: boolean;
  aliases: string[];
  kind?: string;
  sourceCode?: string | null;
  codeSystem?: string;
  sourceUrl?: string;
  boundaryAsOf?: string;
  constituentCountry?: string | null;
}

export interface Subitem {
  id: string;
  name: string;
}

export interface CoordinateMatchEvidence {
  officialSourceUrl: string;
  officialVenueName: string;
  osmName: string;
  osmAddress: string;
  matchedOn: string;
  geometryType: string;
  osmFeatureType: string;
}

export interface CoordinateProvenance {
  coordinateMethod?: string;
  coordinateLicense?: string;
  coordinateLicenseUrl?: string;
  coordinateAttribution?: string;
  coordinateCheckedAt?: string;
  coordinateMatchEvidence?: CoordinateMatchEvidence;
  referenceCoordinates?: [number, number] | null;
  coordinateReferenceOnly?: boolean;
  coordinatePrecisionNote?: string;
  coordinateRole?: string;
  /** Explicit false forbids use as an ordinary destination marker. */
  ordinaryPointEligible?: boolean;
  visitorEntranceVerified?: boolean;
  priorCoordinateEvidence?: {
    coordinates?: [number, number] | null;
    coordinateStatus?: string | null;
    coordinateSourceUrl?: string | null;
    coordinatePrecisionNote?: string | null;
    [field: string]: unknown;
  };
  officialReportCoordinate?: [number, number];
  sourceAuthority?: string;
  sourceRecordId?: string;
  sourceRecordName?: string;
  coordinateEvidenceFile?: string;
}

export interface CatalogEntry extends CoordinateProvenance {
  nameZh?: string;
  nameEn?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
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
  accessibilityStatus?: string;
  accessibilityNote?: string;
  accessibilitySourceUrl?: string;
  linkedRegionId?: string;
  topicRegions?: Partial<Record<Scope, string[]>>;
  heritageType?: string;
  multinational?: boolean;
  year?: string;
  lines?: string[];
  operators?: string[];
  railTypes?: string;
  heritageProjectId?: string;
  heritageComponentId?: string;
  coordinateStatus?: string;
  coordinateSourceUrl?: string;
  componentKey?: string;
  officialComponentId?: string | null;
  parentComponentKey?: string;
  parentOfficialComponentId?: string;
  identifierScheme?: string;
  unitKind?: string;
  officialCoordinatesDms?: string;
  unmappedTopic?: boolean;
  topicAssignment?: string;
  venueId?: string;
  originalName?: string;
  designation?: string;
  sourceId?: string;
  recordKind?: string;
  recognitionSourceIds?: string[];
  nationalHeritageParentId?: string;
  parentSourceId?: string;
  sharedUnescoComponentKey?: string;
  relationship?: string;
  reviewBasis?: string;
  scopeEvidence?: unknown;
  scopeNotes?: string | string[];
  heritageMembershipStatus?: 'inscribed' | 'excluded' | 'superseded';
}

export interface GeometryFeature {
  id: string;
  regionId: string | null;
  level: MapLevel | 'border';
  geometry: Geometry;
}

/** Source snapshots and limits are kept separate from personal visit records. */
export interface TopicCoverage {
  scope: Scope;
  counts: Record<string, number>;
  notes: string[];
  sources: string[];
  boundary?: {
    scope?: Scope;
    countryCode?: string;
    system?: string;
    asOf?: string;
    sourceUrl?: string;
    license?: string;
    licenseUrl?: string;
    limitations?: string[];
    [field: string]: unknown;
  };
}

export interface FootballClub {
  nameZh?: string;
  nameEn?: string;
  originalName?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
  aliases?: string[];
  id: string;
  name: string;
}

export interface FootballVenue extends CoordinateProvenance {
  nameZh?: string;
  nameEn?: string;
  originalName?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
  id: string;
  /** Generated ordinary catalogue entry, independent of any club. */
  entryId: string;
  name: string;
  aliases: string[];
  coordinates: [number, number] | null;
  sourceUrl: string;
  coordinateStatus: string;
  countryCode?: string;
  coordinateSourceUrl?: string;
  verificationStatus?: string;
  additionalSourceUrls?: string[];
  addressSourceUrl?: string;
  checkedAt?: string;
  notes?: string;
}

export interface FootballHomeGround {
  clubId: string;
  venueId: string;
  venueEntryId: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  sourceUrl: string;
  notes?: string;
  /** A single evidenced fixture date must not be treated as an entire temporary tenancy. */
  dateSemantics?: string;
  additionalSourceUrls?: string[];
  fixture?: string;
  verificationBasis?: string;
}

export interface FootballCompetition {
  nameZh?: string;
  nameEn?: string;
  originalName?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
  name?: string;
  aliases?: string[];
  season: string;
  competitionId: string;
  countryCode: string;
  expectedClubCount: number;
  sourceUrl: string;
  checkedAt: string;
  coverage: string;
  coverageMeaning: string;
  clubs: FootballClub[];
  venues: FootballVenue[];
  homeGrounds: FootballHomeGround[];
  clubRosterCoverage: string;
  coordinateCoverage: { verified: number; total: number };
}

export interface FootballCatalog {
  schemaVersion: number;
  checkedAt: string;
  scopeNote: string;
  competitions: FootballCompetition[];
  standaloneVenues: FootballVenue[];
  pendingCompetitions: unknown[];
  limitations: string[];
}

export interface NationalHeritageComponent extends CoordinateProvenance {
  sourceId: string;
  parentSourceId: string;
  name: string;
  originalName: string;
  coordinates: [number, number] | null;
  sourceUrl: string;
  coordinateSourceUrl?: string;
  coordinateStatus?: string;
  locationGranularity: string;
  officialComponentId?: string | null;
  identifierScheme?: string;
  sharedUnescoComponentKey?: string;
  relationship?: string;
  reviewBasis?: string;
  notes?: string[];
}

export interface NationalHeritageRecognition {
  sourceId: string;
  name: string;
  originalName: string;
  coordinates: [number, number] | null;
  designation: string;
  sourceUrl: string;
  recognitionBatch: number;
  recognitionYear: number;
  recordKind: string;
  locationGranularity: string;
  componentsStatus: string;
  regionCodes: string[];
  notes: string[];
  designationDate?: string;
  decisionNumber?: string;
  supplementsSourceId?: string;
  supplementComponentCount?: number;
  components?: NationalHeritageComponent[];
  componentsCoverage?: 'partial' | 'complete-for-source';
}

export interface NationalHeritageDataset {
  scope: Scope;
  countryCode: string;
  designation: string;
  coverage: string;
  asOf: string;
  sourceUrl: string;
  additionalSourceUrls: string[];
  expectedCount: number;
  countUnit: string;
  recognitionRowCoverage: string;
  recognitionRowCount: number;
  mappedCoordinateCount: number;
  identifiedExpansionRowCount: number;
  distinctParentCountAfterKnownExpansionLinks: number;
  independentPhysicalSiteCount: number | null;
  license: string;
  coverageNotes: string[];
  items: NationalHeritageRecognition[];
  parents: {
    sourceId: string;
    entryId: string;
    recognitionSourceIds: string[];
    componentEntryIds?: string[];
    componentsCoverage?: 'pending' | 'partial' | 'complete-for-source';
  }[];
}

export interface NationalHeritageCatalog {
  datasets: NationalHeritageDataset[];
  excludedScopes: { scope: Scope; reason: string }[];
}

export interface Catalog {
  version: string;
  compatibleCatalogVersions?: string[];
  heritageProjects?: HeritageProject[];
  topicCoverage?: TopicCoverage[];
  football?: FootballCatalog;
  nationalHeritage?: NationalHeritageCatalog;
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
