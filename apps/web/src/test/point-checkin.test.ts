import { describe, expect, it } from 'vitest';
import { CatalogIndex } from '@fangyu/catalog';
import {
  HandbookSession,
  applyPointCheckin,
  pointView,
  pointGroup,
  relatedPoints,
  pointRecordIsShared,
  DEFAULT_POINT_POLICIES,
  drawablePoint,
} from '@fangyu/domain';
import { snapshotSchema } from '@fangyu/contracts';
import { catalog, airport, station, beijing, dongcheng } from './fixtures.js';

const parent = '00000000-0000-4000-8000-000000000010';
const other = '00000000-0000-4000-8000-000000000011';
function projectSession(complete = true) {
  const fixture = structuredClone(catalog);
  fixture.entries.push({
    ...fixture.entries[0]!,
    id: parent,
    recordId: parent,
    name: '总项目',
    subitems: [],
  });
  fixture.heritageProjects = [
    {
      unescoId: '1',
      name: '总项目',
      sourceUrl: '',
      checkedAt: '',
      coverage: complete ? 'complete' : 'partial',
      expectedComponentCount: 2,
      legacyEntryIds: [parent],
      componentEntryIds: [airport, station],
    },
  ];
  return new HandbookSession(new CatalogIndex(fixture));
}
describe('independent point records', () => {
  it('marks a point without touching any administrative visit', () => {
    const session = projectSession();
    session.transaction(() =>
      applyPointCheckin(session, [{ entryId: airport, visited: true }], []),
    );
    expect(session.snapshot().regions).toEqual({});
    expect(session.view(session.entry(station)).visited).toBe(false);
    expect(pointView(session, session.entry(parent)).partial).toBe(true);
    expect(session.snapshot().entries[parent]).toBeUndefined();
  });
  it('undoes confirmed points and regions together without downgrading residence', () => {
    const session = projectSession();
    session.transaction(() => session.setRegionState(beijing, 'resident', false));
    session.transaction(() =>
      applyPointCheckin(session, [{ entryId: airport, visited: true }], [dongcheng]),
    );
    expect(session.arrived(dongcheng)).toBe(true);
    expect(session.visitState(beijing)).toBe('resident');
    session.undo();
    expect(session.view(session.entry(airport)).visited).toBe(false);
    expect(session.arrived(dongcheng)).toBe(false);
    expect(session.visitState(beijing)).toBe('resident');
  });
  it('derives a complete project from children and ignores a legacy whole-project visit', () => {
    const session = projectSession();
    session.transaction(() => session.markEntry(parent, true));
    expect(pointView(session, session.entry(parent)).visited).toBe(false);
    session.transaction(() =>
      applyPointCheckin(
        session,
        [airport, station].map((entryId) => ({ entryId, visited: true })),
        [],
      ),
    );
    expect(pointView(session, session.entry(parent)).checked).toBe(true);
    expect(session.snapshot().entries[parent]!.visited).toBe(true);
    expect(() => applyPointCheckin(session, [{ entryId: parent, visited: true }], [])).toThrow(
      '总项目',
    );
  });
  it('never claims completion for an incomplete component inventory', () => {
    const session = projectSession(false);
    session.transaction(() =>
      applyPointCheckin(
        session,
        [airport, station].map((entryId) => ({ entryId, visited: true })),
        [],
      ),
    );
    expect(pointView(session, session.entry(parent))).toMatchObject({
      partial: true,
      checked: false,
    });
  });
  it('records legacy subitems independently with no sibling or regional propagation', () => {
    const fixture = structuredClone(catalog);
    fixture.entries[0]!.subitems = [
      { id: parent, name: 'A' },
      { id: other, name: 'B' },
    ];
    const session = new HandbookSession(new CatalogIndex(fixture));
    session.transaction(() =>
      applyPointCheckin(session, [{ entryId: airport, visited: false, subitemIds: [parent] }], []),
    );
    expect(session.subitemVisited(airport, parent)).toBe(true);
    expect(session.subitemVisited(airport, other)).toBe(false);
    expect(session.snapshot().entries[airport]!.visited).toBe(false);
    expect(session.snapshot().regions).toEqual({});
    expect(pointGroup(session, session.entry(airport))?.complete).toBe(false);
  });
  it('preserves old shared records and refuses to silently change other categories', () => {
    const fixture = structuredClone(catalog);
    fixture.entries[1]!.recordId = airport;
    const session = new HandbookSession(new CatalogIndex(fixture));
    expect(pointRecordIsShared(session, session.entry(airport))).toBe(true);
    const before = session.snapshot();
    expect(() =>
      session.transaction(() =>
        applyPointCheckin(session, [{ entryId: airport, visited: true }], []),
      ),
    ).toThrow('共用记录');
    expect(session.snapshot()).toEqual(before);
  });
  it('uses reviewed relations only and distinguishes overlap from identity', () => {
    const fixture = structuredClone(catalog);
    fixture.entries[1]!.name = fixture.entries[0]!.name;
    const session = new HandbookSession(new CatalogIndex(fixture));
    expect(relatedPoints(session, session.entry(airport))).toEqual([]);
    fixture.entryRelations = [{ fromEntryId: airport, toEntryId: station, kind: 'overlaps' }];
    expect(relatedPoints(session, session.entry(airport))[0]?.kind).toBe('overlaps');
  });
  it('accepts old snapshots and roundtrips each optional confirmation policy', () => {
    const session = projectSession();
    expect(snapshotSchema.parse(session.snapshot()).preferences.pointCheckin).toBeUndefined();
    expect(DEFAULT_POINT_POLICIES).toEqual({ children: 'ask', identities: 'ask', regions: 'ask' });
    session.transaction(() =>
      session.updatePreferences({
        pointCheckin: { children: 'auto', identities: 'never', regions: 'ask' },
      }),
    );
    const restored = new HandbookSession(session.index, snapshotSchema.parse(session.snapshot()));
    expect(restored.preferences.pointCheckin).toEqual({
      children: 'auto',
      identities: 'never',
      regions: 'ask',
    });
  });
  it('does not draw invented or reference-only locations', () => {
    const entry = catalog.entries[0]!;
    expect(drawablePoint(entry)).toBe(true);
    expect(drawablePoint({ ...entry, coordinates: null })).toBe(false);
    expect(drawablePoint({ ...entry, coordinateReferenceOnly: true })).toBe(false);
    expect(drawablePoint({ ...entry, coordinates: [181, 30] })).toBe(false);
  });
});
