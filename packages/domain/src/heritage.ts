import type { Catalog, CatalogEntry } from '@fangyu/contracts';
import type { HeritageProject, HeritageProgress } from '../../contracts/src/heritage.js';
import type { HandbookSession } from './session.js';

type CompatibleCatalog = Catalog & { compatibleCatalogVersions?: readonly string[] };

/** Reviewed entity markers and area/project references have different map semantics. */
export function heritageLocationIsReferenceOnly(
  source: Pick<
    CatalogEntry,
    | 'coordinateRole'
    | 'ordinaryPointEligible'
    | 'coordinateReferenceOnly'
    | 'coordinateStatus'
    | 'unitKind'
  >,
  shared?: Pick<CatalogEntry, 'ordinaryPointEligible' | 'coordinateReferenceOnly'>,
): boolean {
  if (
    source.ordinaryPointEligible === false ||
    source.coordinateReferenceOnly ||
    source.coordinateRole === 'area-reference' ||
    source.coordinateRole === 'project-reference'
  )
    return true;
  // A reviewed independent location supersedes old representative evidence, which stays in provenance.
  if (source.ordinaryPointEligible === true) return false;
  return Boolean(
    shared?.coordinateReferenceOnly ||
    shared?.ordinaryPointEligible === false ||
    /representative|summary|reference-point/i.test(source.coordinateStatus || '') ||
    source.unitKind === 'official-project-geographical-row',
  );
}

/** A whitelist admits known additive releases only; record validation still runs afterwards. */
export function acceptsCatalogVersion(catalog: CompatibleCatalog, version: string): boolean {
  return (
    catalog.version === version || Boolean(catalog.compatibleCatalogVersions?.includes(version))
  );
}

/** Run against the actual previous catalogue before publishing a compatibility whitelist. */
export function assertAdditiveCatalogCompatibility(
  previous: Catalog,
  next: CompatibleCatalog,
): void {
  if (!acceptsCatalogVersion(next, previous.version)) {
    throw Error('Previous catalogue version is not explicitly compatible.');
  }
  const regions = new Map(next.regions.map((region) => [region.id, region]));
  if (regions.size !== next.regions.length) throw Error('Duplicate catalogue region IDs.');
  for (const region of previous.regions) {
    const retained = regions.get(region.id);
    if (
      !retained ||
      retained.parentId !== region.parentId ||
      retained.scope !== region.scope ||
      retained.level !== region.level ||
      retained.historical !== region.historical
    ) {
      throw Error(`Existing region identity or ancestry changed: ${region.id}`);
    }
  }
  const categories = new Set(next.categories.map((category) => category.id));
  if (previous.categories.some((category) => !categories.has(category.id))) {
    throw Error('Existing category was removed.');
  }
  const entries = new Map(next.entries.map((entry) => [entry.id, entry]));
  if (entries.size !== next.entries.length) throw Error('Duplicate catalogue entry IDs.');
  for (const entry of previous.entries) {
    const retained = entries.get(entry.id);
    if (!retained || retained.recordId !== entry.recordId) {
      throw Error(`Existing entry or record identity changed: ${entry.id}`);
    }
    const subitems = new Set(retained.subitems.map((subitem) => subitem.id));
    if (entry.subitems.some((subitem) => !subitems.has(subitem.id))) {
      throw Error(`Existing subitem was removed: ${entry.id}`);
    }
  }
  for (const entry of next.entries) {
    const canonical = entries.get(entry.recordId);
    if (!canonical || canonical.recordId !== canonical.id) {
      throw Error(`Missing or indirect canonical record: ${entry.id}`);
    }
  }
}

/** Merge country references to one global property. Conflicting official counts need review. */
export function deduplicateHeritageProjects(
  projects: readonly HeritageProject[],
): HeritageProject[] {
  const merged = new Map<string, HeritageProject>();
  for (const project of projects) {
    if (!/^\d+$/.test(project.unescoId)) throw Error('Use a canonical numeric UNESCO property ID.');
    const existing = merged.get(project.unescoId);
    if (!existing) {
      merged.set(project.unescoId, structuredClone(project));
      continue;
    }
    if (
      existing.expectedComponentCount !== undefined &&
      project.expectedComponentCount !== undefined &&
      existing.expectedComponentCount !== project.expectedComponentCount
    ) {
      throw Error(`Conflicting official component counts: ${project.unescoId}`);
    }
    if (
      existing.expectedComponentCount === undefined &&
      project.expectedComponentCount !== undefined
    ) {
      existing.expectedComponentCount = project.expectedComponentCount;
    }
    existing.componentEntryIds.push(...project.componentEntryIds);
    existing.legacyEntryIds.push(...project.legacyEntryIds);
    if (project.officialComponentGroups) {
      existing.officialComponentGroups ??= [];
      for (const incoming of project.officialComponentGroups) {
        const group = existing.officialComponentGroups.find(
          (candidate) => candidate.officialComponentId === incoming.officialComponentId,
        );
        if (group) group.componentEntryIds.push(...incoming.componentEntryIds);
        else existing.officialComponentGroups.push(structuredClone(incoming));
      }
    }
    if (existing.countryCodes || project.countryCodes) {
      existing.countryCodes = [...(existing.countryCodes || []), ...(project.countryCodes || [])];
    }
    // Combining two partial country extracts does not prove global completeness.
    if (existing.coverage !== 'complete' || project.coverage !== 'complete') {
      existing.coverage = 'partial';
    }
  }
  return [...merged.values()].map((project) => {
    project.componentEntryIds = [...new Set(project.componentEntryIds)];
    project.legacyEntryIds = [...new Set(project.legacyEntryIds)];
    for (const group of project.officialComponentGroups || [])
      group.componentEntryIds = [...new Set(group.componentEntryIds)];
    if (project.applicationPlaceCount !== undefined || project.officialComponentGroups)
      project.applicationPlaceCount = project.componentEntryIds.length;
    if (project.countryCodes) project.countryCodes = [...new Set(project.countryCodes)];
    return project;
  });
}

/** Reject ambiguous identities before wiring the property into a catalogue. */
export function validateHeritageProjects(
  catalog: Catalog,
  projects: readonly HeritageProject[],
): void {
  const entries = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const ids = new Set<string>();
  for (const project of projects) {
    if (!/^\d+$/.test(project.unescoId)) throw Error('Use a canonical numeric UNESCO property ID.');
    if (ids.has(project.unescoId)) throw Error(`Duplicate UNESCO property: ${project.unescoId}`);
    ids.add(project.unescoId);
    const legacyRecords = new Set(project.legacyEntryIds.map((id) => entries.get(id)?.recordId));
    for (const id of [...project.legacyEntryIds, ...project.componentEntryIds]) {
      if (!entries.has(id)) throw Error(`Unknown heritage entry: ${id}`);
    }
    for (const id of project.componentEntryIds) {
      if (legacyRecords.has(entries.get(id)!.recordId)) {
        throw Error(`Component cannot inherit a legacy project record: ${id}`);
      }
    }
    const count = new Set(project.componentEntryIds).size;
    if (count !== project.componentEntryIds.length)
      throw Error(`Duplicate application place: ${project.unescoId}`);
    if (project.applicationPlaceCount !== undefined && project.applicationPlaceCount !== count)
      throw Error(`Invalid application place count: ${project.unescoId}`);
    let officialCount = count;
    if (project.officialComponentGroups) {
      const officialIds = new Set<string>();
      const groupedEntries = new Set<string>();
      const applicationIds = new Set(project.componentEntryIds);
      for (const group of project.officialComponentGroups) {
        if (!group.officialComponentId || officialIds.has(group.officialComponentId))
          throw Error(`Duplicate or missing official component group: ${project.unescoId}`);
        officialIds.add(group.officialComponentId);
        if (!group.componentEntryIds.length)
          throw Error(`Empty official component group: ${group.officialComponentId}`);
        for (const id of group.componentEntryIds) {
          if (!applicationIds.has(id) || groupedEntries.has(id))
            throw Error(`Application place must belong to exactly one official group: ${id}`);
          if (entries.get(id)?.officialComponentId !== group.officialComponentId)
            throw Error(`Application place has a different official component ID: ${id}`);
          groupedEntries.add(id);
        }
      }
      if (groupedEntries.size !== count)
        throw Error(`Ungrouped application place: ${project.unescoId}`);
      officialCount = officialIds.size;
    }
    const expected = project.expectedComponentCount;
    if (
      expected !== undefined &&
      (!Number.isSafeInteger(expected) || expected < 1 || officialCount > expected)
    ) {
      throw Error(`Invalid official component count: ${project.unescoId}`);
    }
    if (project.coverage === 'complete' && (expected === undefined || officialCount !== expected)) {
      throw Error(
        `Complete coverage requires a verified full component inventory: ${project.unescoId}`,
      );
    }
  }
}

export function heritageProgress(
  session: HandbookSession,
  project: HeritageProject,
): HeritageProgress {
  const entries = session.index.entries;
  const legacyRecords = new Set(project.legacyEntryIds.map((id) => entries.get(id)?.recordId));
  const components = [...new Set(project.componentEntryIds)];
  const valid = components.flatMap((id) => {
    const entry = entries.get(id);
    return entry && !legacyRecords.has(entry.recordId) ? [entry] : [];
  });
  const visited = (recordId: string | undefined) => {
    const entry = recordId ? entries.get(recordId) : undefined;
    return entry ? session.view(entry).visited : false;
  };
  const visitedComponents = valid.filter((entry) => visited(entry.recordId)).length;
  const expected = project.expectedComponentCount;
  const groups = project.officialComponentGroups;
  const validIds = new Set(valid.map((entry) => entry.id));
  const visitedOfficialComponents = groups?.filter(
    (group) =>
      group.componentEntryIds.length > 0 &&
      group.componentEntryIds.every((id) => validIds.has(id) && visited(entries.get(id)?.recordId)),
  ).length;
  const totalComponents = groups
    ? components.length + Math.max(0, (expected ?? groups.length) - groups.length)
    : (expected ?? components.length);
  return {
    legacyVisited: [...legacyRecords].some(visited),
    visitedComponents,
    totalComponents,
    availableComponents: valid.length,
    ...(groups
      ? {
          visitedOfficialComponents: visitedOfficialComponents ?? 0,
          totalOfficialComponents: expected ?? groups.length,
          availableOfficialComponents: groups.length,
        }
      : {}),
    complete:
      project.coverage === 'complete' &&
      expected !== undefined &&
      expected > 0 &&
      valid.length === totalComponents &&
      visitedComponents === totalComponents &&
      (!groups || (groups.length === expected && visitedOfficialComponents === expected)),
  };
}
