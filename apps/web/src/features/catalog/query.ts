import type { CatalogQuery } from '../../app/workspace.js';
import type { HandbookSession, EntryView } from '@fangyu/domain';
export interface CatalogQueryResult {
  ids: string[];
  coordinateCount: number;
  groups: { id: string; ids: string[]; marked: number }[];
  regions: string[];
}
export function inBounds(point: [number, number], bounds: [number, number, number, number]) {
  const [rawWest, south, rawEast, north] = bounds;
  const normalize = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
  const west = normalize(rawWest),
    east = normalize(rawEast);
  return (
    point[1] >= south &&
    point[1] <= north &&
    (rawEast - rawWest >= 360 ||
      (west <= east ? point[0] >= west && point[0] <= east : point[0] >= west || point[0] <= east))
  );
}
export class CatalogSearch {
  private rows: EntryView[];
  private text = new Map<string, string>();
  private paths = new Map<string, string>();
  constructor(private session: HandbookSession) {
    this.rows = session.entries();
    for (const e of this.rows) {
      this.text.set(
        e.id,
        [
          e.name,
          e.path,
          e.code,
          e.description,
          ...e.aliases,
          ...(e.lines || []),
          ...(e.operators || []),
          ...e.subitems.map((s) => s.name),
        ]
          .join(' ')
          .toLocaleLowerCase(),
      );
      this.paths.set(e.id, e.regionIds.map((id) => session.index.paths.get(id) || '').join(' / '));
    }
    this.rows.sort(
      (a, b) =>
        (this.paths.get(a.id) || '').localeCompare(this.paths.get(b.id) || '', 'zh-CN') ||
        a.name.localeCompare(b.name, 'zh-CN') ||
        a.id.localeCompare(b.id),
    );
  }
  update(session: HandbookSession) {
    const fresh = session.entries();
    const previous = new Map(this.rows.map((row) => [row.id, row]));
    if (
      fresh.length !== this.rows.length ||
      fresh.some((row) => previous.get(row.id)?.name !== row.name)
    ) {
      return new CatalogSearch(session);
    }
    this.session = session;
    const byId = new Map(fresh.map((row) => [row.id, row]));
    this.rows = this.rows.map((row) => byId.get(row.id)!);
    return this;
  }
  query(q: CatalogQuery): CatalogQueryResult {
    const query = q.text.trim().toLocaleLowerCase();
    const retained = new Set(q.retainedIds);
    const matching = this.rows.filter((e) => {
      const owners = this.session.index.entryRegions(e, q.scope);
      if (
        !owners.length ||
        (q.regionId &&
          !owners.some((id) =>
            q.descendants ? this.session.index.belongsTo(id, q.regionId) : id === q.regionId,
          ))
      )
        return false;
      if (q.categories.length && !q.categories.includes(e.categoryId)) return false;
      if (query && !this.text.get(e.id)!.includes(query)) return false;
      if (q.railType && !e.railTypes?.includes(q.railType)) return false;
      if (q.missingCoordinates && e.coordinates) return false;
      if (q.bounds && (!e.coordinates || !inBounds(e.coordinates, q.bounds))) return false;
      return (
        retained.has(e.id) ||
        !q.status ||
        (q.status === 'visited' ? e.visited : q.status === 'partial' ? e.partial : !e.visited)
      );
    });
    const groups = this.session.index.catalog.categories.map((c) => {
      const rows = matching.filter((e) => e.categoryId === c.id);
      return { id: c.id, ids: rows.map((e) => e.id), marked: rows.filter((e) => e.visited).length };
    });
    const regions = query
      ? this.session.index.catalog.regions
          .filter(
            (r) =>
              r.scope === q.scope &&
              [r.name, r.code, ...r.aliases].join(' ').toLocaleLowerCase().includes(query),
          )
          .slice(0, 30)
          .map((r) => r.id)
      : [];
    return {
      ids: matching.map((e) => e.id),
      coordinateCount: matching.filter((e) => e.coordinates).length,
      groups,
      regions,
    };
  }
}
