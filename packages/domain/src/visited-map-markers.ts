import { getScopeConfig, type CatalogEntry, type MapLayers, type Scope } from '@fangyu/contracts';
import type { HeritageProject } from '../../contracts/src/heritage.js';
import { heritageLocationIsReferenceOnly } from './heritage.js';
import type { HandbookSession } from './session.js';

export interface VisitedMapMarker {
  /** Stable, canonical visit identity, shared by aliases in different topics. */
  id: string;
  entryId: string;
  recordId: string;
  name: string;
  coordinates: [number, number];
  kind: 'airport' | 'world-heritage' | 'project-reference';
  partial: boolean;
  note?: string;
  sourceUrl?: string;
  coordinateNote?: string;
  coordinateEvidenceEntryId?: string;
}
/** Curated identity evidence supplies a location only, never another entry's visit state. */
export interface VerifiedVisitedMapAssociation {
  entryId: string;
  recordId: string;
  targetEntryId: string;
  kind: 'airport' | 'project-reference';
  reviewStatus: 'verified-source-identifier';
  identity: {
    scheme: 'iata' | 'unesco-id';
    value: string;
    sourceField: string;
    sourceUrl: string;
    sourceFile?: string;
  };
  basis: string;
  note?: string;
}
export type VisitedMapLayer = 'airport' | 'world-heritage';
export interface OmittedVisitedMapMarker {
  id: string;
  entryId: string;
  recordId: string;
  name: string;
  layer: VisitedMapLayer;
  reason:
    | 'missing-coordinates'
    | 'reference-only'
    | 'unverified-project-reference'
    | 'ambiguous-coordinates';
}
export interface VisitedMapMarkerOptions {
  scope: Scope;
  selectedRegionId?: string;
  /** Omission uses saved preferences. This layer does not inherit category, search or zoom filters. */
  layers?: Readonly<MapLayers>;
  associations?: readonly VerifiedVisitedMapAssociation[];
}
interface LayerCount {
  visited: number;
  mapped: number;
  omitted: number;
}
export interface VisitedMapMarkersResult {
  markers: VisitedMapMarker[];
  omitted: OmittedVisitedMapMarker[];
  counts: {
    visitedRecords: number;
    mappedRecords: number;
    omittedRecords: number;
    airports: LayerCount;
    worldHeritage: LayerCount;
    projectReferences: number;
  };
}
type Point = [number, number];
type Location = {
  coordinates: Point;
  kind: VisitedMapMarker['kind'];
  sourceUrl?: string;
  coordinateNote?: string;
  coordinateEvidenceEntryId?: string;
};
type LocationResult = { location: Location } | { reason: OmittedVisitedMapMarker['reason'] };
const PROJECT_NOTE = '项目级代表位置，不表示所有组成地点到访，也不是入口定位。';

function coordinates(value: unknown): Point | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[1]) > 90
  )
    return undefined;
  return [value[0], value[1]];
}
function officialProjectUrl(
  value: string | undefined,
  unescoId: string,
  mapsOnly = false,
): boolean {
  if (!value || !/^\d+$/.test(unescoId)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'whc.unesco.org' &&
      (mapsOnly
        ? url.pathname === `/en/list/${unescoId}/maps/` ||
          url.pathname === `/en/list/${unescoId}/maps`
        : new RegExp(`^/(?:en|fr|es|zh|ru|ar)/list/${unescoId}/?$`).test(url.pathname))
    );
  } catch {
    return false;
  }
}
function excluded(entry: CatalogEntry): boolean {
  return (
    entry.heritageMembershipStatus === 'excluded' ||
    entry.heritageMembershipStatus === 'superseded' ||
    /^(?:excluded-world-heritage|superseded-component)-record$/.test(entry.recordKind || '')
  );
}
function ambiguousReference(entry: CatalogEntry): boolean {
  return (
    /(?:area|linear|group|shared|anomal)/i.test(entry.coordinateRole || '') ||
    /(?:anomal|unverified|excluded|superseded|shared|summary|range-reference|linear-reference|group-reference)/i.test(
      entry.coordinateStatus || '',
    )
  );
}
function ordinaryLocation(entry: CatalogEntry, kind: 'airport' | 'world-heritage'): LocationResult {
  if (heritageLocationIsReferenceOnly(entry) || ambiguousReference(entry))
    return { reason: 'reference-only' };
  const point = coordinates(entry.coordinates);
  if (!point) return { reason: 'missing-coordinates' };
  return {
    location: {
      coordinates: point,
      kind,
      ...(entry.coordinateSourceUrl || entry.source
        ? { sourceUrl: entry.coordinateSourceUrl || entry.source! }
        : {}),
      ...(entry.coordinatePrecisionNote
        ? { coordinateNote: entry.coordinatePrecisionNote }
        : kind === 'world-heritage'
          ? { coordinateNote: '组成地点参考位置；不视为已核实入口。' }
          : {}),
    },
  };
}

function projectLocation(
  session: HandbookSession,
  entry: CatalogEntry,
  project: HeritageProject | undefined,
  dataHubSourceVerified: boolean,
): LocationResult {
  // Explicit project geography is evidence for a parent marker, never a child visit.
  // No arbitrary component location or name-based association may supply this coordinate.
  const references: Location[] = [];
  if (project && project.legacyEntryIds.includes(entry.id)) {
    for (const id of project.componentEntryIds) {
      const row = session.index.entries.get(id);
      if (
        !row ||
        excluded(row) ||
        row.heritageProjectId !== project.unescoId ||
        row.unitKind !== 'official-project-geographical-row' ||
        ambiguousReference(row) ||
        (entry.countryCode && row.countryCode !== entry.countryCode) ||
        !(
          row.coordinateRole === 'project-reference' ||
          row.coordinateStatus === 'official-project-representative-coordinate'
        )
      )
        continue;
      const point = coordinates(row.referenceCoordinates);
      const sourceUrl = row.coordinateSourceUrl || row.source;
      if (!point || !officialProjectUrl(sourceUrl, project.unescoId, true)) continue;
      references.push({
        coordinates: point,
        kind: 'project-reference',
        sourceUrl: sourceUrl!,
        coordinateEvidenceEntryId: row.id,
        coordinateNote: `${PROJECT_NOTE}${row.coordinatePrecisionNote ? ` ${row.coordinatePrecisionNote}` : ''}`,
      });
    }
  }
  if (references.length) {
    if (references.length !== 1) return { reason: 'ambiguous-coordinates' };
    return { location: references[0]! };
  }
  // Legacy world data is positively identified by its recorded UNESCO DataHub source.
  // A null or explicitly suppressed legacy coordinate is never revived by this path.
  const point = coordinates(entry.coordinates);
  if (
    entry.scope === 'world' &&
    dataHubSourceVerified &&
    point &&
    entry.code &&
    officialProjectUrl(entry.source, entry.code) &&
    entry.ordinaryPointEligible !== false &&
    !entry.coordinateReferenceOnly &&
    !ambiguousReference(entry) &&
    !/retained-project-record-no-component-location|missing/i.test(entry.coordinateStatus || '')
  ) {
    return {
      location: {
        coordinates: point,
        kind: 'project-reference',
        sourceUrl: entry.source!,
        coordinateNote: PROJECT_NOTE,
      },
    };
  }
  return { reason: !point ? 'missing-coordinates' : 'unverified-project-reference' };
}

function associatedLocation(
  session: HandbookSession,
  entry: CatalogEntry,
  associations: readonly VerifiedVisitedMapAssociation[],
  projectsByLegacy: Map<string, HeritageProject>,
  dataHubSourceVerified: boolean,
): LocationResult | undefined {
  if (
    entry.ordinaryPointEligible === false ||
    entry.coordinateReferenceOnly ||
    ambiguousReference(entry)
  )
    return undefined;
  const approved: Location[] = [];
  for (const row of associations) {
    if (
      row.entryId !== entry.id ||
      row.recordId !== entry.recordId ||
      row.reviewStatus !== 'verified-source-identifier' ||
      !row.basis ||
      !row.identity.sourceField ||
      !row.identity.sourceUrl
    )
      continue;
    const target = session.index.entries.get(row.targetEntryId);
    if (!target || excluded(target) || row.identity.value !== target.code) continue;
    let location: LocationResult | undefined;
    if (
      row.kind === 'airport' &&
      row.identity.scheme === 'iata' &&
      entry.categoryId === 'airport' &&
      entry.scope === 'china' &&
      target.categoryId === 'airport' &&
      target.scope === 'world' &&
      target.countryCode === 'CHN'
    ) {
      const value = row.identity.value;
      const literalCode =
        row.identity.sourceField === 'code'
          ? entry.code
          : row.identity.sourceField === 'name-prefix'
            ? /^([A-Z]{3})(?=[^A-Z]|$)/.exec(entry.name)?.[1]
            : undefined;
      if (
        !/^[A-Z]{3}$/.test(value) ||
        literalCode !== value ||
        session.index.catalog.entries.filter(
          (e) => e.categoryId === 'airport' && e.scope === 'world' && e.code === value,
        ).length !== 1
      )
        continue;
      try {
        const url = new URL(target.source || '');
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'ourairports.com' ||
          !/^\/airports\/[^/]+\/?$/.test(url.pathname) ||
          row.identity.sourceUrl !== target.source
        )
          continue;
      } catch {
        continue;
      }
      location = ordinaryLocation(target, 'airport');
    } else if (
      row.kind === 'project-reference' &&
      row.identity.scheme === 'unesco-id' &&
      entry.categoryId === 'world-heritage' &&
      entry.scope === 'china' &&
      target.categoryId === 'world-heritage' &&
      target.scope === 'world' &&
      target.countryCode === 'CHN'
    ) {
      const inlineEvidence =
        row.identity.sourceField === 'code' && entry.code === row.identity.value;
      const externalEvidence = Boolean(
        row.identity.sourceFile &&
        row.identity.sourceField !== 'name' &&
        row.identity.sourceField !== 'name-prefix',
      );
      if (
        (!inlineEvidence && !externalEvidence) ||
        !officialProjectUrl(row.identity.sourceUrl, row.identity.value)
      )
        continue;
      location = projectLocation(
        session,
        target,
        projectsByLegacy.get(target.id),
        dataHubSourceVerified,
      );
    }
    if (location && 'location' in location)
      approved.push({
        ...location.location,
        coordinateEvidenceEntryId: target.id,
        coordinateNote:
          row.kind === 'project-reference'
            ? `${PROJECT_NOTE}${row.note ? ` ${row.note}` : ''}`
            : row.note ||
              '以原始机场 IATA 标识核对既有 OurAirports 位置；保留本条独立到访记录，未继承其他机场记录。',
      });
  }
  if (approved.length > 1) return { reason: 'ambiguous-coordinates' };
  return approved.length === 1 ? { location: approved[0]! } : undefined;
}

/** Pure selector over real visit records; never marks regions, parents, children or sibling aliases. */
export function visitedMapMarkers(
  session: HandbookSession,
  options: VisitedMapMarkerOptions,
): VisitedMapMarkersResult {
  const layers = options.layers || session.preferences.mapLayers;
  const result: VisitedMapMarkersResult = {
    markers: [],
    omitted: [],
    counts: {
      visitedRecords: 0,
      mappedRecords: 0,
      omittedRecords: 0,
      airports: { visited: 0, mapped: 0, omitted: 0 },
      worldHeritage: { visited: 0, mapped: 0, omitted: 0 },
      projectReferences: 0,
    },
  };
  if (!layers?.visitedAirports && !layers?.visitedWorldHeritage) return result;
  const country = getScopeConfig(options.scope).countryCode;
  const projectsByLegacy = new Map<string, HeritageProject>();
  for (const project of session.index.catalog.heritageProjects || [])
    for (const id of project.legacyEntryIds) projectsByLegacy.set(id, project);
  const dataHubSourceVerified = session.index.catalog.sources.some((source) => {
    if (
      !source ||
      typeof source !== 'object' ||
      !('url' in source) ||
      typeof source.url !== 'string'
    )
      return false;
    try {
      const url = new URL(source.url);
      return (
        url.protocol === 'https:' &&
        url.hostname === 'data.unesco.org' &&
        /^\/explore\/assets\/whc001\/?$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  });
  type Candidate = {
    entry: CatalogEntry;
    name: string;
    partial: boolean;
    note: string;
    layer: VisitedMapLayer;
    result: LocationResult;
  };
  const records = new Map<string, Candidate[]>();
  for (const entry of session.allEntries()) {
    const layer: VisitedMapLayer | undefined =
      entry.categoryId === 'airport'
        ? 'airport'
        : ['world-heritage', 'world-heritage-component'].includes(entry.categoryId)
          ? 'world-heritage'
          : undefined;
    if (
      !layer ||
      excluded(entry) ||
      (layer === 'airport' ? !layers?.visitedAirports : !layers?.visitedWorldHeritage)
    )
      continue;
    const assigned = session.index.entryRegions(entry, options.scope);
    const belongs =
      assigned.length > 0 ||
      entry.scope === options.scope ||
      Boolean(country && entry.scope === 'world' && entry.countryCode === country);
    if (!belongs) continue;
    if (
      options.selectedRegionId &&
      !assigned.some((id) => session.index.belongsTo(id, options.selectedRegionId!))
    )
      continue;
    const view = session.view(entry);
    if (!view.visited) continue;
    let location =
      entry.categoryId === 'world-heritage'
        ? projectLocation(session, entry, projectsByLegacy.get(entry.id), dataHubSourceVerified)
        : ordinaryLocation(entry, layer);
    if ('reason' in location && location.reason === 'missing-coordinates' && options.associations)
      location =
        associatedLocation(
          session,
          entry,
          options.associations,
          projectsByLegacy,
          dataHubSourceVerified,
        ) || location;
    const group = records.get(entry.recordId) || [];
    group.push({
      entry,
      name: view.name,
      partial: view.partial,
      note: view.note,
      layer,
      result: location,
    });
    records.set(entry.recordId, group);
  }
  for (const [recordId, candidates] of records) {
    candidates.sort(
      (a, b) =>
        Number(b.entry.id === recordId) - Number(a.entry.id === recordId) ||
        a.entry.id.localeCompare(b.entry.id),
    );
    const layerSet = new Set(candidates.map((c) => c.layer));
    const counters = [...layerSet].map((layer) =>
      layer === 'airport' ? result.counts.airports : result.counts.worldHeritage,
    );
    for (const count of counters) count.visited++;
    const eligible = candidates.filter(
      (c): c is Candidate & { result: { location: Location } } => 'location' in c.result,
    );
    let chosen: (Candidate & { result: { location: Location } }) | undefined = eligible[0];
    const conflicted =
      eligible.length > 1 &&
      new Set(eligible.map((c) => c.result.location.coordinates.join(','))).size > 1;
    // A canonical eligible row is the record's own point; without one, conflicting alias points are withheld.
    if (conflicted && chosen?.entry.id !== recordId) chosen = undefined;
    if (chosen) {
      result.markers.push({
        id: recordId,
        recordId,
        entryId: chosen.entry.id,
        name: chosen.name,
        partial: chosen.partial,
        ...(chosen.note ? { note: chosen.note } : {}),
        ...chosen.result.location,
      });
      for (const count of counters) count.mapped++;
    } else {
      const candidate = candidates[0]!;
      result.omitted.push({
        id: recordId,
        recordId,
        entryId: candidate.entry.id,
        name: candidate.name,
        layer: candidate.layer,
        reason: conflicted
          ? 'ambiguous-coordinates'
          : 'reason' in candidate.result
            ? candidate.result.reason
            : 'missing-coordinates',
      });
      for (const count of counters) count.omitted++;
    }
  }
  result.markers.sort((a, b) => a.id.localeCompare(b.id));
  result.omitted.sort((a, b) => a.id.localeCompare(b.id));
  result.counts.visitedRecords = records.size;
  result.counts.mappedRecords = result.markers.length;
  result.counts.omittedRecords = result.omitted.length;
  result.counts.projectReferences = result.markers.filter(
    (m) => m.kind === 'project-reference',
  ).length;
  return result;
}
