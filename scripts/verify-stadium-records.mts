import assert from 'node:assert/strict';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import {
  emptySnapshot,
  snapshotSchema,
  type Catalog,
  type CatalogEntry,
  type StadiumExperience,
} from '../packages/contracts/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';

// Synthetic IDs and records only; never read user records or credentials.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n: number, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: id(n),
  recordId: id(n),
  scope: 'uk',
  regionIds: [id(1)],
  categoryId: 'football-stadium',
  name: `Synthetic venue ${n}`,
  aliases: [],
  subitems: [],
  ...extra,
});
const catalog: Catalog = {
  version: 'synthetic-stadium-v1',
  categories: [
    { id: 'football-stadium', name: 'Stadium' },
    { id: 'heritage', name: 'Heritage' },
  ],
  regions: [
    {
      id: id(1),
      parentId: null,
      scope: 'uk',
      level: 1,
      name: 'Synthetic region',
      code: 'SYN',
      historical: true,
      aliases: [],
    },
  ],
  entries: [
    entry(2),
    entry(3, { recordId: id(2) }),
    entry(4, { categoryId: 'heritage' }),
    entry(5),
  ],
  achievements: { definitions: [], quantityRegionIds: [] },
  sources: [],
};
const index = new CatalogIndex(catalog);
const old = emptySnapshot(catalog.version);
old.entries[id(2)] = { visited: true, subitemIds: [] };
const session = new HandbookSession(index, old);
assert.equal(session.snapshot().version, 1);
assert.equal(session.view(session.entry(id(2))).visited, true);
assert.equal(session.stadiumExperience(id(2), 'tour'), false);
assert.equal(session.stadiumExperience(id(2), 'match'), false);
session.transaction(() => session.markStadiumExperience(id(3), 'match', true));
assert.equal(session.snapshot().version, 2);
assert.equal(session.stadiumExperience(id(2), 'match'), true);
assert.equal(session.stadiumExperience(id(3), 'match'), true);
assert.equal(session.stadiumExperience(id(2), 'tour'), false);
assert.deepEqual(session.snapshot().regions, {});
const exported = JSON.parse(JSON.stringify(session.snapshot()));
const restored = new HandbookSession(index, snapshotSchema.parse(exported));
assert.equal(restored.stadiumExperience(id(3), 'match'), true);
assert.equal(restored.snapshot().version, 2);
session.undo();
assert.equal(session.snapshot().version, 1);
assert.equal(session.stadiumExperience(id(2), 'match'), false);
assert.equal(session.view(session.entry(id(2))).visited, true);
session.transaction(() => session.markStadiumExperience(id(5), 'tour', true));
assert.equal(session.view(session.entry(id(5))).visited, false);
assert.deepEqual(session.snapshot().regions, {});
session.transaction(() => session.markStadiumExperience(id(5), 'match', true));
session.transaction(() => session.markStadiumExperience(id(5), 'match', true));
assert.deepEqual(session.snapshot().entries[id(5)]!.stadiumExperiences, ['tour', 'match']);
session.transaction(() => session.markEntry(id(5), true));
session.transaction(() => session.markEntry(id(5), false));
assert.equal(session.stadiumExperience(id(5), 'tour'), true);
assert.equal(session.stadiumExperience(id(5), 'match'), true);
session.transaction(() => session.clearVisits());
assert.equal(session.stadiumExperience(id(5), 'match'), true);
assert.equal(session.view(session.entry(id(5))).visited, false);
session.transaction(() => session.markStadiumExperience(id(5), 'tour', false));
assert.equal(session.stadiumExperience(id(5), 'tour'), false);
assert.equal(session.stadiumExperience(id(5), 'match'), true);
session.undo();
assert.equal(session.stadiumExperience(id(5), 'tour'), true);
const beforeInvalid = session.snapshot();
assert.throws(() =>
  session.transaction(() =>
    session.markStadiumExperience(id(5), 'unknown' as StadiumExperience, true),
  ),
);
assert.deepEqual(session.snapshot(), beforeInvalid);
assert.throws(() => session.markStadiumExperience(id(4), 'tour', true));
assert.throws(() => session.stadiumExperience(id(4), 'tour'));
assert.throws(() => session.markStadiumExperience(id(99), 'tour', true));
assert.throws(() => session.markStadiumExperience(id(5), 'tour', 'true' as unknown as boolean));
const forgedV1 = structuredClone(exported);
forgedV1.version = 1;
assert.equal(snapshotSchema.safeParse(forgedV1).success, false);
const forgedType = structuredClone(exported);
forgedType.entries[id(2)].stadiumExperiences = ['unknown'];
assert.equal(snapshotSchema.safeParse(forgedType).success, false);
const forgedNonStadium = structuredClone(exported);
forgedNonStadium.entries[id(4)] = { visited: false, subitemIds: [], stadiumExperiences: ['tour'] };
assert.throws(() => new HandbookSession(index, forgedNonStadium));
assert.equal(emptySnapshot(catalog.version).version, 1);
console.log(
  'PASS old v1 remains valid; experiences independent; v2 export/import; shared venue; undo; clearing visits retains experiences; invalid type/category/version rejected.',
);
