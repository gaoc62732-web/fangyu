import { describe, it, expect } from 'vitest';
import { CatalogSearch, inBounds } from './query.js';
import type { CatalogQuery } from '../../app/workspace.js';
import { createSession, dongcheng, beijing, catalog } from '../../test/fixtures.js';
function query(patch: Partial<CatalogQuery> = {}): CatalogQuery {
  return {
    scope: 'china',
    regionId: '',
    descendants: true,
    categories: [],
    text: '',
    status: '',
    missingCoordinates: false,
    railType: '',
    bounds: null,
    retainedIds: [],
    ...patch,
  };
}
describe('catalog navigation contracts', () => {
  it('includes descendants while allowing a direct-level directory', () => {
    const engine = new CatalogSearch(createSession());
    const all = engine.query(query({ regionId: beijing }));
    const direct = engine.query(query({ regionId: beijing, descendants: false }));
    expect(all.ids.length).toBeGreaterThan(direct.ids.length);
    expect(all.groups.filter((g) => g.ids.length).length).toBeGreaterThan(1);
  });
  it('theme results are independent of the previously inspected region', () => {
    const engine = new CatalogSearch(createSession());
    const local = engine.query(query({ regionId: dongcheng, categories: ['world-heritage'] }));
    const theme = engine.query(query({ categories: ['world-heritage'] }));
    expect(theme.ids.length).toBe(245);
    expect(theme.coordinateCount).toBe(0);
    expect(theme.ids.length).toBeGreaterThan(local.ids.length);
  });
  it('retains a just-marked row in an unvisited query without reordering it', () => {
    const session = createSession();
    const before = new CatalogSearch(session).query(
      query({ regionId: dongcheng, status: 'unvisited' }),
    );
    const id = before.ids[0]!;
    session.transaction(() => session.markEntry(id, true, dongcheng));
    const after = new CatalogSearch(session).query(
      query({ regionId: dongcheng, status: 'unvisited', retainedIds: [id] }),
    );
    expect(after.ids).toEqual(before.ids);
  });
  it('searches component names and reports matching regions separately', () => {
    const engine = new CatalogSearch(createSession());
    const item = catalog.entries.find((e) => e.scope === 'china' && e.subitems.length)!;
    const results = engine.query(query({ text: item.subitems[0]!.name }));
    expect(results.ids).toContain(item.id);
    expect(engine.query(query({ text: '东城区' })).regions).toContain(dongcheng);
  });
  it('only shows true coordinate entries in explicit viewport queries', () => {
    const engine = new CatalogSearch(createSession());
    const result = engine.query(query({ scope: 'world', bounds: [-180, -85, 180, 85] }));
    expect(result.ids.length).toBe(result.coordinateCount);
    expect(result.coordinateCount).toBeGreaterThan(5000);
  });
  it('supports crossing the antimeridian', () => {
    expect(inBounds([179, 10], [170, -20, -170, 20])).toBe(true);
    expect(inBounds([-179, 10], [170, -20, -170, 20])).toBe(true);
    expect(inBounds([0, 10], [170, -20, -170, 20])).toBe(false);
    expect(inBounds([-179, 10], [170, -20, 210, 20])).toBe(true);
    expect(inBounds([0, 10], [-180, -85, 180, 85])).toBe(true);
  });
  it('keeps a multi-item write and its region propagation in one undo', () => {
    const s = createSession();
    const ids = new CatalogSearch(s).query(query({ regionId: dongcheng })).ids.slice(0, 2);
    s.transaction(() => ids.forEach((id) => s.markEntry(id, true, dongcheng)));
    expect(s.arrived(dongcheng)).toBe(true);
    expect(ids.every((id) => s.view(s.entry(id)).visited)).toBe(true);
    s.undo();
    expect(s.arrived(dongcheng)).toBe(false);
    expect(ids.every((id) => !s.view(s.entry(id)).visited)).toBe(true);
  });
  it('warm queries stay within the 300ms target on this machine', () => {
    const engine = new CatalogSearch(createSession());
    engine.query(query({ scope: 'japan', text: '東京' }));
    const start = performance.now();
    engine.query(query({ scope: 'japan', text: '東京' }));
    expect(performance.now() - start).toBeLessThan(300);
  });
});
