/** Synthetic records only: no personal archives or actual travel histories are read. */
import assert from 'node:assert/strict';
import type {
  Catalog,
  RecordSnapshot,
  Region,
  VisitState,
} from '../packages/contracts/src/index.js';
import { emptySnapshot, VISIT_RANK, VISIT_STATES } from '../packages/contracts/src/index.js';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import {
  reachedRegions,
  quantityProgress,
  maofenProgress,
  achievementProgress,
} from '../packages/domain/src/achievements.js';
import { PALETTES } from '../packages/domain/src/appearance.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const province = id(1),
  city = id(2),
  countyA = id(3),
  countyB = id(4);
const cityB = id(5),
  countyC = id(6),
  town = id(7),
  foreignCity = id(8),
  foreignCounty = id(9);
const historicCounty = id(10),
  provinceDirectCounty = id(11),
  unrelatedChild = id(12);
const historicCity = id(13),
  historicCityCounty = id(14);
const region = (
  n: number,
  parentId: string | null,
  level: number,
  extra: Partial<Region> = {},
): Region => ({
  id: id(n),
  parentId,
  level,
  scope: 'china',
  code: `100${String(n).padStart(3, '0')}`,
  name: `Synthetic ${n}`,
  aliases: [],
  historical: false,
  ...extra,
});
const catalog: Catalog = {
  version: 'county-test-v2',
  compatibleCatalogVersions: ['county-test-v1'],
  regions: [
    region(1, null, 0),
    region(2, province, 1),
    region(3, city, 2),
    region(4, city, 2),
    region(5, province, 1),
    region(6, cityB, 2),
    region(7, countyA, 3),
    region(8, null, 1, { scope: 'france' }),
    region(9, foreignCity, 2, { scope: 'france' }),
    region(10, city, 2, { historical: true }),
    region(11, province, 2),
    region(12, city, 2, { scope: 'japan' }),
    region(13, province, 1, { historical: true }),
    region(14, historicCity, 2, { historical: true }),
  ],
  entries: [
    {
      id: id(20),
      recordId: id(20),
      scope: 'china',
      regionIds: [countyA],
      categoryId: 'place',
      name: 'Synthetic place',
      aliases: [],
      subitems: [{ id: id(21), name: 'Synthetic part' }],
    },
  ],
  categories: [{ id: 'place', name: 'Place' }],
  sources: [],
  achievements: {
    quantityRegionIds: [city, cityB],
    definitions: [
      {
        id: 'synthetic-city',
        title: 'Synthetic cities',
        section: 'test',
        note: '',
        pending: [],
        sources: [],
        targets: [
          {
            label: 'City A',
            regionIds: [city],
            condition: { mode: 'any', regionIds: [city], inferAncestors: false },
          },
        ],
      },
    ],
  },
};
const index = new CatalogIndex(catalog);
const create = (states: Record<string, VisitState> = {}) => {
  const snapshot = emptySnapshot(catalog.version);
  snapshot.regions = states;
  return new HandbookSession(index, snapshot);
};
assert.deepEqual(VISIT_STATES, [
  'unvisited',
  'flyover',
  'transit',
  'arrived',
  'shortstay',
  'resident',
]);
assert(VISIT_RANK.resident > VISIT_RANK.shortstay && VISIT_RANK.shortstay > VISIT_RANK.arrived);

// All manual parent levels remain the floor; only explicit direct county residence raises it.
const states: readonly VisitState[] = VISIT_STATES;
for (const manual of states)
  for (const child of states) {
    const s = create({ [city]: manual, [countyA]: child, [province]: 'unvisited' });
    const expected: VisitState =
      ['shortstay', 'resident'].includes(child) && VISIT_RANK[child] > VISIT_RANK[manual]
        ? child
        : manual;
    const before = s.snapshot();
    assert.equal(s.visitState(city), expected, `${manual} parent / ${child} county`);
    assert.equal(
      s.snapshot().regions[city],
      manual,
      'Derived state must not overwrite a manual record',
    );
    assert.equal(
      s.recordedVisitState(city),
      manual,
      'UI can distinguish saved choice from effective state',
    );
    assert.equal(
      s.visitState(province),
      'unvisited',
      'Residence does not aggregate to the province',
    );
    assert.equal(s.visitState(countyB), 'unvisited', 'Residence does not propagate to siblings');
    assert.equal(s.visitState(town), 'unvisited', 'Residence does not propagate downward');
    assert.deepEqual(s.snapshot(), before, 'State, map and statistics reads have no mutation');
  }
const single = create({ [countyA]: 'shortstay', [province]: 'unvisited' });
assert.equal(single.visitState(city), 'shortstay');
assert.equal(single.hasExplicitState(city), false);
assert.equal(single.recordedVisitState(city), 'unvisited');
assert.equal(single.arrived(city), true);
assert(reachedRegions(single).has(city));
assert(!reachedRegions(single).has(province));
assert.equal(quantityProgress(single).count, 1);
assert.equal(achievementProgress(single).find((a) => a.id === 'synthetic-city')!.count, 1);
assert.equal(maofenProgress(single).counts[1], 1);
assert.equal(
  PALETTES.jade.colors[single.visitState(city)],
  PALETTES.jade.colors.shortstay,
  'Map color and statistics use the same effective city state',
);
const explicitLow = create({ [city]: 'transit', [countyA]: 'resident', [province]: 'unvisited' });
assert(explicitLow.hasExplicitState(city));
assert.equal(explicitLow.visitState(city), 'resident');
assert(
  reachedRegions(explicitLow).has(city),
  'Explicit low raw state cannot suppress real derived county residence',
);
assert.equal(quantityProgress(explicitLow).count, 1);
assert.equal(PALETTES.jade.colors[explicitLow.visitState(city)], PALETTES.jade.colors.resident);

// Clearing/moving the strongest county dynamically restores the parent's own state.
const moving = create({
  [city]: 'transit',
  [cityB]: 'flyover',
  [countyA]: 'resident',
  [countyB]: 'shortstay',
  [province]: 'unvisited',
});
const rawParents = {
  [city]: moving.snapshot().regions[city],
  [cityB]: moving.snapshot().regions[cityB],
};
moving.transaction(() => moving.setRegionState(countyA, 'unvisited', false));
assert.equal(moving.visitState(city), 'shortstay');
moving.transaction(() => {
  moving.setRegionState(countyB, 'unvisited', false);
  moving.setRegionState(countyC, 'resident', false);
});
assert.equal(moving.visitState(city), 'transit');
assert.equal(moving.visitState(cityB), 'resident');
assert.equal(quantityProgress(moving).count, 1);
moving.transaction(() => moving.setRegionState(countyC, 'shortstay', false));
assert.equal(moving.visitState(cityB), 'shortstay');
moving.transaction(() => moving.setRegionState(countyC, 'unvisited', false));
assert.equal(moving.visitState(cityB), 'flyover');
assert.equal(quantityProgress(moving).count, 0);
moving.undo();
assert.equal(moving.visitState(cityB), 'shortstay');
moving.undo();
assert.equal(moving.visitState(cityB), 'resident');
moving.undo();
assert.equal(moving.visitState(city), 'shortstay');
assert.equal(moving.visitState(cityB), 'flyover');
moving.undo();
assert.equal(moving.visitState(city), 'resident');
for (const [key, value] of Object.entries(rawParents))
  assert.equal(moving.snapshot().regions[key], value);
moving.transaction(() => moving.setRegionState(countyA, 'resident', false));
assert.equal(
  quantityProgress(moving).count,
  1,
  'Repeated county clicks never double-count the city',
);
moving.transaction(() => moving.setRegionState(countyB, 'resident', false));
assert.equal(quantityProgress(moving).count, 1, 'Multiple resident counties count one city');
moving.transaction(() => moving.setRegionState(city, 'resident', false));
moving.transaction(() => {
  moving.setRegionState(countyA, 'unvisited', false);
  moving.setRegionState(countyB, 'unvisited', false);
});
assert.equal(
  moving.visitState(city),
  'resident',
  'Manual resident survives clearing all county evidence',
);

// Derivation is direct, scope-limited and independent of ordinary arrival propagation.
for (const child of [town, foreignCounty, provinceDirectCounty, unrelatedChild]) {
  const s = create({ [child]: 'resident' });
  assert.equal(s.visitState(city), 'unvisited');
  assert.equal(s.visitState(foreignCity), 'unvisited');
  assert.equal(s.visitState(province), 'unvisited');
}
const historical = create({ [historicCounty]: 'resident' });
assert.equal(
  historical.visitState(city),
  'resident',
  'Existing historical county residence remains evidence for its direct city identity',
);
const historicalBoth = create({ [historicCityCounty]: 'shortstay' });
assert.equal(historicalBoth.visitState(historicCity), 'shortstay');
assert.equal(historicalBoth.visitState(city), 'unvisited');
const defaultPropagation = create({ [city]: 'transit', [province]: 'arrived' });
defaultPropagation.transaction(() => defaultPropagation.setRegionState(countyA, 'resident'));
assert.equal(defaultPropagation.visitState(city), 'resident');
assert.equal(
  defaultPropagation.snapshot().regions[city],
  'transit',
  'Default setter must not erase the old parent floor',
);
assert.equal(
  defaultPropagation.visitState(province),
  'arrived',
  'Existing arrival propagation never upgrades province residence',
);
for (const state of ['shortstay', 'arrived', 'unvisited'] as const) {
  defaultPropagation.transaction(() => defaultPropagation.setRegionState(countyA, state));
  assert.equal(
    defaultPropagation.recordedVisitState(city),
    'transit',
    'County residence/arrival downgrade preserves explicit parent',
  );
  assert.equal(
    defaultPropagation.visitState(city),
    state === 'shortstay' ? 'shortstay' : 'transit',
  );
}
const noParent = create();
noParent.transaction(() => noParent.setRegionState(countyA, 'resident'));
assert.equal(noParent.visitState(city), 'resident');
assert.equal(noParent.hasExplicitState(city), false);
noParent.transaction(() => noParent.setRegionState(countyA, 'unvisited'));
assert.equal(noParent.visitState(city), 'unvisited');
assert.equal(noParent.hasExplicitState(city), false);
assert.equal(
  Object.hasOwn(noParent.snapshot().regions, city),
  false,
  'First residence and clear never persist an inferred parent key',
);
const savedArrival = create({ [city]: 'arrived' });
savedArrival.transaction(() => savedArrival.setRegionState(countyA, 'resident'));
savedArrival.transaction(() => savedArrival.setRegionState(countyA, 'unvisited'));
assert.equal(savedArrival.visitState(city), 'arrived');
assert.equal(
  savedArrival.recordedVisitState(city),
  'arrived',
  'Unattributed old arrival is retained, not guessed to be automatic',
);
const explicitUnvisited = create({ [city]: 'unvisited' });
explicitUnvisited.transaction(() => explicitUnvisited.setRegionState(countyA, 'resident'));
assert(reachedRegions(explicitUnvisited).has(city));
explicitUnvisited.transaction(() => explicitUnvisited.setRegionState(countyA, 'arrived'));
assert.equal(explicitUnvisited.recordedVisitState(city), 'unvisited');
assert.equal(explicitUnvisited.visitState(city), 'unvisited');
assert(
  !reachedRegions(explicitUnvisited).has(city),
  'After residence ends, explicit parent exclusion resumes',
);
assert.equal(quantityProgress(explicitUnvisited).count, 0);

// Old archives rehydrate effective state without saving any inferred parent record.
const old = emptySnapshot('county-test-v1');
old.regions = { [countyA]: 'resident', [province]: 'unvisited', [city]: 'shortstay' };
old.entries[id(20)] = {
  visited: false,
  subitemIds: [id(21)],
  name: 'My own title',
  note: 'Preserve this note',
};
old.customEntries = [
  {
    id: id(30),
    recordId: id(30),
    scope: 'china',
    regionIds: [countyA],
    categoryId: 'place',
    name: 'My custom place',
    aliases: ['My own alias'],
    subitems: [],
  },
];
old.entries[id(30)] = {
  visited: true,
  subitemIds: [],
  name: 'My renamed custom place',
  note: 'Custom note',
};
const pristine = structuredClone(old);
const migrated = new HandbookSession(index, old);
assert.deepEqual(old, pristine);
assert.deepEqual(migrated.snapshot().regions, old.regions);
assert.deepEqual(migrated.snapshot().entries, old.entries);
assert.deepEqual(migrated.snapshot().customEntries, old.customEntries);
assert.equal(migrated.visitState(city), 'resident');
assert.equal(migrated.snapshot().regions[city], 'shortstay');
assert.equal(migrated.view(migrated.entry(id(20))).name, 'My own title');
const refresh = new HandbookSession(
  index,
  JSON.parse(JSON.stringify(migrated.snapshot())) as RecordSnapshot,
);
assert.equal(refresh.visitState(city), 'resident');
assert.deepEqual(refresh.snapshot(), migrated.snapshot());
migrated.transaction(() => migrated.clearVisits());
assert.equal(migrated.visitState(city), 'unvisited');
assert.equal(quantityProgress(migrated).count, 0);
assert.equal(migrated.snapshot().entries[id(20)]!.name, 'My own title');
assert.equal(migrated.snapshot().entries[id(20)]!.note, 'Preserve this note');
assert.deepEqual(migrated.snapshot().customEntries, old.customEntries);
migrated.undo();
assert.deepEqual(migrated.snapshot().regions, old.regions);
assert.deepEqual(migrated.snapshot().entries, old.entries);
assert.equal(migrated.visitState(city), 'resident');
migrated.replace({
  ...migrated.snapshot(),
  regions: { [countyB]: 'shortstay', [city]: 'resident' },
});
assert.equal(migrated.visitState(city), 'resident', 'Replacement keeps a stronger manual parent');
migrated.replace({ ...migrated.snapshot(), regions: { [countyB]: 'shortstay' } });
assert.equal(migrated.visitState(city), 'shortstay');
assert.equal(migrated.hasExplicitState(city), false);
assert.equal(migrated.visitState(countyA), 'unvisited');
console.log(
  'PASS county residence: 36 manual/child rank combinations; direct China county-to-city derivation; unchanged stored parent; map/statistics agreement; multi-county move/clear/restore; undo/refresh/old snapshots; custom names/notes/entries retained; no province/downward/non-China residence inference.',
);
