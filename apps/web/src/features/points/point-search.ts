import type { CatalogEntry, Scope } from '@fangyu/contracts';
import type { CatalogIndex } from '@fangyu/catalog';
import { searchText } from '../search-text.js';

export interface PointSearchResult {
  id: string;
  entry: CatalogEntry;
  subitemId?: string;
  name: string;
  parentName?: string;
  regionIds: string[];
  path: string;
  text: string;
}

export function pointSearchItems(entries: CatalogEntry[], index: CatalogIndex, scope: Scope) {
  const items: PointSearchResult[] = [];
  const inScope = (ids: string[]) => [...new Set(ids.map((id) => index.resolveRegion(id)))]
    .filter((id) => index.regions.get(id)?.scope === scope);
  const pathFor = (ids: string[]) => ids.map((id) => index.paths.get(id) || '').filter(Boolean).join(' / ');
  for (const entry of entries) {
    const regionIds = inScope([
      ...index.entryRegions(entry, scope),
      ...entry.regionIds,
      ...entry.subitems.flatMap((child) => child.regionIds || []),
    ]);
    const path = pathFor(regionIds);
    const name = entry.nameZh || entry.name;
    items.push({
      id: entry.id, entry, name, regionIds, path,
      text: searchText([name, entry.name, entry.nameEn, ...entry.aliases].filter(Boolean).join(' ')),
    });
    for (const child of entry.subitems) {
      const childRegions = inScope(child.regionIds?.length ? child.regionIds : regionIds);
      if (!childRegions.length) continue;
      const childPath = pathFor(childRegions);
      items.push({
        id: entry.id + '__subitem__' + child.id,
        entry, subitemId: child.id, name: child.name, parentName: name,
        regionIds: childRegions, path: childPath,
        text: searchText(child.name),
      });
    }
  }
  return items;
}
