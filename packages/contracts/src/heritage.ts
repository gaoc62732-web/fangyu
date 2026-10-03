/** Coverage describes the whole UNESCO property, including its transnational components. */
export type HeritageCoverage = 'pending' | 'partial' | 'complete';

/** One official unit may contain several separately visitable places. */
export interface HeritageOfficialComponentGroup {
  officialComponentId: string;
  componentEntryIds: string[];
}

export interface HeritageProject {
  /** UNESCO property number, without a country suffix or revision suffix. */
  unescoId: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
  originalName?: string;
  aliases?: string[];
  sourceUrl: string;
  checkedAt: string;
  coverage: HeritageCoverage;
  /** Official global component count; absence means it has not been verified. */
  expectedComponentCount?: number;
  /** Ordinary, independently visitable CatalogEntry IDs. */
  componentEntryIds: string[];
  /** Present when application places are finer-grained than official component units. */
  officialComponentGroups?: HeritageOfficialComponentGroup[];
  /** Number of currently imported application places, never the official UNESCO total. */
  applicationPlaceCount?: number;
  /** Retained project-level entries; their old visits never imply component visits. */
  legacyEntryIds: string[];
  countryCodes?: string[];
}

export interface HeritageProgress {
  legacyVisited: boolean;
  visitedComponents: number;
  /** Application places: accounts for known expansions of official component groups. */
  totalComponents: number;
  availableComponents: number;
  /** Available only for projects with an explicit official-unit grouping. */
  visitedOfficialComponents?: number;
  totalOfficialComponents?: number;
  availableOfficialComponents?: number;
  complete: boolean;
}
