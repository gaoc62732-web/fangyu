import type { Catalog, CatalogEntry, GeometryFeature, Region, Scope } from '@fangyu/contracts';

export class CatalogIndex {
  readonly regions: Map<string, Region>;
  readonly entries: Map<string, CatalogEntry>;
  readonly children = new Map<string | null, Region[]>();
  readonly paths = new Map<string, string>();
  readonly byRecord = new Map<string, CatalogEntry[]>();
  private readonly ancestorIds = new Map<string, Set<string>>();

  constructor(readonly catalog: Catalog) {
    this.regions = new Map(catalog.regions.map((region) => [region.id, region]));
    this.entries = new Map(catalog.entries.map((entry) => [entry.id, entry]));

    for (const region of catalog.regions) {
      const siblings = this.children.get(region.parentId) || [];
      siblings.push(region);
      this.children.set(region.parentId, siblings);
    }
    for (const region of catalog.regions) {
      const ancestors = this.ancestors(region.id);
      this.ancestorIds.set(region.id, new Set(ancestors.map((item) => item.id)));
      this.paths.set(region.id, ancestors.map((item) => item.name).join(' / '));
    }
    for (const entry of catalog.entries) {
      const linkedEntries = this.byRecord.get(entry.recordId) || [];
      linkedEntries.push(entry);
      this.byRecord.set(entry.recordId, linkedEntries);
    }
  }

  ancestors(id: string): Region[] {
    const path: Region[] = [];
    const visited = new Set<string>();
    let region = this.regions.get(id);
    while (region && !visited.has(region.id)) {
      visited.add(region.id);
      path.unshift(region);
      region = region.parentId ? this.regions.get(region.parentId) : undefined;
    }
    return path;
  }

  belongsTo(id: string, parentId: string): boolean {
    return this.ancestorIds.get(id)?.has(parentId) || false;
  }

  entryRegions(entry: CatalogEntry, scope: Scope): string[] {
    return entry.topicRegions?.[scope] || (entry.scope === scope ? entry.regionIds : []);
  }
}

export async function loadGeometry(baseUrl: string, scope: Scope): Promise<GeometryFeature[]> {
  const response = await fetch(baseUrl + scope + '.geo.json');
  if (!response.ok) throw Error('无法加载地图：' + response.status);
  return response.json() as Promise<GeometryFeature[]>;
}
