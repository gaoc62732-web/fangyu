import type { Catalog, CatalogEntry, Scope, PointCheckinPreferences } from '@fangyu/contracts';
import type { CatalogIndex } from '@fangyu/catalog';
import type { HandbookSession, EntryView } from './session.js';
import { heritageLocationIsReferenceOnly } from './heritage.js';

export const DEFAULT_POINT_POLICIES: PointCheckinPreferences = {
  identities: 'auto',
  regions: 'ask',
};
export interface PointChild {
  id: string;
  name: string;
  entryId: string;
  subitemId?: string;
  self?: boolean;
  regionIds?: string[];
  coordinates?: [number, number] | null;
  locationNote?: string;
  description?: string;
  attributes?: Record<string, unknown>;
}
export interface PointGroup {
  name: string;
  children: PointChild[];
  complete: boolean;
}
const groupIndexes = new WeakMap<CatalogIndex, Map<string, PointGroup>>();
function groupIndex(session: HandbookSession) {
  const index = session.index;
  let groups = groupIndexes.get(index);
  if (groups) return groups;
  const catalog: Catalog = index.catalog;
  groups = new Map();
  const childrenFor = (ids: string[]) =>
    ids.flatMap((id) => {
      const entry = session.index.entries.get(id);
      return entry
        ? [{
            id,
            name: entry.name,
            entryId: id,
            coordinates: entry.coordinates,
            regionIds: entry.regionIds,
            locationNote: entry.locationNote ?? entry.coordinatePrecisionNote,
          }]
        : [];
    });
  for (const project of catalog.heritageProjects || [])
    for (const id of project.legacyEntryIds)
      groups.set(id, {
        name: project.name,
        children: childrenFor(project.componentEntryIds),
        complete:
          project.coverage === 'complete' &&
          project.expectedComponentCount !== undefined &&
          project.componentEntryIds.every((id) => session.index.entries.has(id)) &&
          (project.officialComponentGroups
            ? project.officialComponentGroups.length === project.expectedComponentCount
            : project.componentEntryIds.length === project.expectedComponentCount),
      });
  for (const parent of catalog.nationalHeritage?.datasets.flatMap((d) => d.parents) || [])
    if (parent.componentEntryIds?.length)
      groups.set(parent.entryId, {
        name: session.index.entries.get(parent.entryId)?.name || '',
        children: childrenFor(parent.componentEntryIds),
        complete:
          parent.componentsCoverage === 'complete-for-source' &&
          parent.componentEntryIds.every((id) => session.index.entries.has(id)),
      });
  groupIndexes.set(index, groups);
  return groups;
}

export function pointGroup(session: HandbookSession, entry: CatalogEntry): PointGroup | undefined {
  const known = groupIndex(session).get(entry.id) || groupIndex(session).get(entry.recordId);
  const children = session.entry(entry.recordId).subitems;
  const group = known || (children.length
    ? {
      name: entry.name,
      children: children.map((child) => ({ ...child, entryId: entry.id, subitemId: child.id })),
      complete: false,
    }
    : undefined);
  if (!group) return;
  const members = group.children.filter((child) => child.subitemId || child.entryId !== entry.id);
  return {
    ...group,
    children: drawablePoint(entry)
      ? [{ id: entry.id, entryId: entry.id, name: entry.name, self: true,
          coordinates: entry.coordinates, regionIds: entry.regionIds,
          locationNote: entry.locationNote ?? entry.coordinatePrecisionNote }, ...members]
      : members,
  };
}
export function childVisited(session: HandbookSession, child: PointChild): boolean {
  return child.self
    ? session.pointSelfVisited(child.entryId)
    : child.subitemId
    ? session.subitemVisited(child.entryId, child.subitemId)
    : session.view(session.entry(child.entryId)).checked;
}
export function pointView(session: HandbookSession, entry: CatalogEntry): EntryView {
  return session.view(entry);
}
export function pointRecordIsShared(session: HandbookSession, entry: CatalogEntry): boolean {
  return (
    new Set((session.index.byRecord.get(entry.recordId) || [entry]).map((e) => e.categoryId)).size >
    1
  );
}
export function drawablePoint(entry: CatalogEntry): boolean {
  const c = entry.coordinates;
  return Boolean(
    c &&
    c.length === 2 &&
    c.every(Number.isFinite) &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90 &&
    !heritageLocationIsReferenceOnly(entry),
  );
}
export function relatedPoints(session: HandbookSession, entry: CatalogEntry) {
  return (session.index.catalog.entryRelations || []).flatMap((relation) => {
    const id =
      relation.fromEntryId === entry.id
        ? relation.toEntryId
        : relation.toEntryId === entry.id
          ? relation.fromEntryId
          : undefined;
    const target = id ? session.index.entries.get(id) : undefined;
    return target ? [{ entry: target, kind: relation.kind }] : [];
  });
}
export function pointRegions(
  session: HandbookSession,
  entry: CatalogEntry,
  scope: Scope,
): string[] {
  const inScope = session.index.entryRegions(entry, scope);
  const ids = inScope.length ? inScope : entry.regionIds;
  return [...new Set(ids)].filter((id) => session.index.regions.has(id));
}
export interface PointChange {
  entryId: string;
  visited: boolean;
  subitemIds?: string[];
  selfVisited?: boolean;
}
export function applyPointCheckin(
  session: HandbookSession,
  changes: PointChange[],
  regions: string[],
) {
  for (const change of changes) {
    const group = pointGroup(session, session.entry(change.entryId));
    if (change.subitemIds !== undefined) {
      if (group && !group.children.some((child) => child.subitemId))
        throw Error('总项目状态须由组成地点计算。');
      session.setPointSubitems(change.entryId, change.subitemIds, change.selfVisited);
    } else if (change.selfVisited !== undefined && group?.children.some((child) => child.self)) {
      session.setPointSelfVisited(change.entryId, change.selfVisited);
    } else {
      if (group) throw Error('总项目状态须由组成地点计算。');
      session.markPointEntry(change.entryId, change.visited);
    }
  }
  for (const id of new Set(regions)) session.upgradeRegion(id, 'arrived');
}
