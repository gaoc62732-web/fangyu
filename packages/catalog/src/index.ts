import type { Catalog, CatalogEntry, GeometryFeature, Region, Scope } from '@fangyu/contracts';
import {
  CHINA_BOUNDARY_OPTIONS,
  DEFAULT_CHINA_BOUNDARIES,
  type ChinaBoundarySettings,
} from '@fangyu/contracts';

export class CatalogIndex {
  readonly regions: Map<string, Region>;
  readonly entries: Map<string, CatalogEntry>;
  readonly children = new Map<string | null, Region[]>();
  readonly paths = new Map<string, string>();
  readonly byRecord = new Map<string, CatalogEntry[]>();
  private readonly ancestorIds = new Map<string, Set<string>>();
  private readonly sourceRegions: Region[];
  private activeRegions: Region[];
  private readonly regionAliases = new Map<string, string>();
  private boundaryConfiguration = '';

  constructor(private readonly sourceCatalog: Catalog) {
    const catalog = sourceCatalog;
    this.sourceRegions = catalog.regions;
    this.activeRegions = catalog.regions;
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

  get catalog(): Catalog {
    return { ...this.sourceCatalog, regions: this.activeRegions };
  }

  ancestors(id: string): Region[] {
    const path: Region[] = [];
    const visited = new Set<string>();
    let region = this.regions.get(this.resolveRegion(id));
    while (region && !visited.has(region.id)) {
      visited.add(region.id);
      path.unshift(region);
      region = region.parentId ? this.regions.get(region.parentId) : undefined;
    }
    return path;
  }

  belongsTo(id: string, parentId: string): boolean {
    return this.ancestorIds.get(this.resolveRegion(id))?.has(this.resolveRegion(parentId)) || false;
  }

  entryRegions(entry: CatalogEntry, scope: Scope): string[] {
    return [
      ...new Set(
        (entry.topicRegions?.[scope] || (entry.scope === scope ? entry.regionIds : [])).map((id) =>
          this.resolveRegion(id),
        ),
      ),
    ];
  }

  resolveRegion(id: string): string {
    return this.regionAliases.get(id) || id;
  }

  recordRegionIds(id: string): string[] {
    const target = this.resolveRegion(id);
    return [
      target,
      ...[...this.regionAliases].filter(([, owner]) => owner === target).map(([source]) => source),
    ];
  }

  configureChinaBoundaries(settings: ChinaBoundarySettings = DEFAULT_CHINA_BOUNDARIES): void {
    const configuration = CHINA_BOUNDARY_OPTIONS.map((option) =>
      settings[option.key] ? '1' : '0',
    ).join('');
    if (configuration === this.boundaryConfiguration) return;
    this.boundaryConfiguration = configuration;
    this.regionAliases.clear();
    for (const option of CHINA_BOUNDARY_OPTIONS) {
      if (settings[option.key]) {
        for (const id of ('hiddenWhenEnabled' in option ? option.hiddenWhenEnabled : [])) {
          const target = 'enabledTarget' in option ? option.enabledTarget : undefined;
          if (target && this.regions.has(id) && this.regions.has(target))
            this.regionAliases.set(id, target);
        }
      } else if (this.regions.has(option.target)) {
        for (const id of option.ids)
          if (this.regions.has(id)) this.regionAliases.set(id, option.target);
      }
    }
    this.activeRegions = this.sourceRegions.filter((r) => !this.regionAliases.has(r.id));
    this.children.clear();
    this.ancestorIds.clear();
    this.paths.clear();
    for (const region of this.catalog.regions) {
      const siblings = this.children.get(region.parentId) || [];
      siblings.push(region);
      this.children.set(region.parentId, siblings);
    }
    for (const region of this.sourceRegions) {
      const ancestors = this.ancestors(region.id);
      this.ancestorIds.set(region.id, new Set(ancestors.map((r) => r.id)));
      this.paths.set(region.id, ancestors.map((r) => r.name).join(' / '));
    }
  }
}

export async function loadGeometry(baseUrl: string, scope: Scope): Promise<GeometryFeature[]> {
  const response = await fetch(baseUrl + scope + '.geo.json');
  if (!response.ok) throw Error('无法加载地图：' + response.status);
  return response.json() as Promise<GeometryFeature[]>;
}
