import type { Catalog, CatalogEntry, Scope, PointCheckinPreferences } from '@fangyu/contracts';
import type { HandbookSession, EntryView } from './session.js';
import { heritageLocationIsReferenceOnly } from './heritage.js';

export const DEFAULT_POINT_POLICIES: PointCheckinPreferences = {
  children: 'ask',
  identities: 'ask',
  regions: 'ask',
};
export interface PointChild {
  id: string;
  name: string;
  entryId: string;
  subitemId?: string;
}
export interface PointGroup {
  name: string;
  children: PointChild[];
  complete: boolean;
}
const groupIndexes = new WeakMap<Catalog, Map<string, PointGroup>>();
function groupIndex(session: HandbookSession) {
  const catalog = session.index.catalog;
  let groups = groupIndexes.get(catalog);
  if (groups) return groups;
  groups = new Map();
  const childrenFor = (ids: string[]) =>
    ids.flatMap((id) => {
      const entry = session.index.entries.get(id);
      return entry ? [{ id, name: entry.name, entryId: id }] : [];
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
  groupIndexes.set(catalog, groups);
  return groups;
}

export function pointGroup(session: HandbookSession, entry: CatalogEntry): PointGroup | undefined {
  const known = groupIndex(session).get(entry.id) || groupIndex(session).get(entry.recordId);
  if (known) return known;
  const children = session.entry(entry.recordId).subitems;
  if (children.length)
    return {
      name: entry.name,
      children: children.map((child) => ({ ...child, entryId: entry.id, subitemId: child.id })),
      // Legacy subitem lists do not carry an official completeness assertion.
      complete: false,
    };
}
export function childVisited(session: HandbookSession, child: PointChild): boolean {
  return child.subitemId
    ? session.subitemVisited(child.entryId, child.subitemId)
    : session.view(session.entry(child.entryId)).checked;
}
export function pointView(session: HandbookSession, entry: CatalogEntry): EntryView {
  const view = session.view(entry);
  const group = pointGroup(session, entry);
  if (!group) return view;
  const count = group.children.filter((child) => childVisited(session, child)).length;
  const checked = group.complete && group.children.length > 0 && count === group.children.length;
  return { ...view, checked, partial: count > 0 && !checked, visited: count > 0 };
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
}
export function applyPointCheckin(
  session: HandbookSession,
  changes: PointChange[],
  regions: string[],
) {
  for (const change of changes) {
    const group = pointGroup(session, session.entry(change.entryId));
    if (group && (change.subitemIds === undefined || !group.children.some((c) => c.subitemId)))
      throw Error('总项目状态须由组成地点计算。');
    if (change.subitemIds) session.setPointSubitems(change.entryId, change.subitemIds);
    else session.markPointEntry(change.entryId, change.visited);
  }
  for (const id of new Set(regions)) session.upgradeRegion(id, 'arrived');
}
