/** Browser regression fixture made entirely from catalogue identities and synthetic visits. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalog, CatalogEntry, Scope } from '../packages/contracts/src/index.js';
import { emptySnapshot } from '../packages/contracts/src/index.js';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import { heritageLocationIsReferenceOnly } from '../packages/domain/src/heritage.js';
import { visitedMapMarkers } from '../packages/domain/src/visited-map-markers.js';

const root = resolve(import.meta.dirname, '..');
const catalog: Catalog = JSON.parse(
  await readFile(resolve(root, 'data/catalog/catalog.json'), 'utf8'),
);
const associationFile = JSON.parse(
  await readFile(
    resolve(root, 'data/extensions/research/china-airport-map-associations.json'),
    'utf8',
  ),
);
const snapshot = emptySnapshot(catalog.version);
snapshot.preferences.mapLayers = { visitedAirports: true, visitedWorldHeritage: true };
const cases: {
  label: string;
  scope: Scope;
  entryId: string;
  recordId: string;
  originalName: string;
}[] = [];
function add(label: string, scope: Scope, entry: CatalogEntry | undefined) {
  assert(entry, `Fixture catalogue case missing: ${label}`);
  snapshot.entries[entry.recordId] = {
    visited: true,
    subitemIds: [],
    note: `Synthetic browser fixture: ${label}; not a real travel record.`,
  };
  cases.push({
    label,
    scope,
    entryId: entry.id,
    recordId: entry.recordId,
    originalName: entry.name,
  });
}
const safe = (entry: CatalogEntry) =>
  Boolean(entry.coordinates && !heritageLocationIsReferenceOnly(entry));
add(
  'china-existing-airport-location',
  'china',
  catalog.entries.find((e) => e.scope === 'china' && e.categoryId === 'airport' && safe(e)),
);
add(
  'china-reviewed-iata-airport-location',
  'china',
  catalog.entries.find(
    (e) => e.scope === 'china' && e.categoryId === 'airport' && e.name === 'PEK北京首都',
  ),
);
add(
  'china-local-heritage-unlocated',
  'china',
  catalog.entries.find(
    (e) => e.scope === 'china' && e.categoryId === 'world-heritage' && !e.coordinates,
  ),
);
add(
  'china-world-project-own-record',
  'china',
  catalog.entries.find(
    (e) =>
      e.scope === 'world' &&
      e.categoryId === 'world-heritage' &&
      e.countryCode === 'CHN' &&
      e.coordinates &&
      e.code,
  ),
);
add(
  'japan-airport-national-only',
  'japan',
  catalog.entries.find(
    (e) => e.scope === 'world' && e.categoryId === 'airport' && e.countryCode === 'JPN' && safe(e),
  ),
);
add(
  'france-real-component',
  'france',
  catalog.entries.find(
    (e) => e.categoryId === 'world-heritage-component' && e.countryCode === 'FRA' && safe(e),
  ),
);
add(
  'indonesia-real-component',
  'indonesia',
  catalog.entries.find(
    (e) => e.categoryId === 'world-heritage-component' && e.countryCode === 'IDN' && safe(e),
  ),
);
add(
  'reference-only-component-omitted',
  'indonesia',
  catalog.entries.find(
    (e) =>
      e.categoryId === 'world-heritage-component' &&
      e.countryCode === 'IDN' &&
      e.coordinateReferenceOnly,
  ),
);
snapshot.entries[cases[1]!.recordId]!.name = '合成机场自定义名 · Synthetic Airport Label';
const session = new HandbookSession(new CatalogIndex(catalog), snapshot);
const expectedByScope = Object.fromEntries(
  (['china', 'japan', 'france', 'indonesia'] as const).map((scope) => [
    scope,
    visitedMapMarkers(session, { scope, associations: associationFile.associations }),
  ]),
);
assert(expectedByScope.china!.markers.some((m) => m.kind === 'project-reference'));
assert(
  expectedByScope.china!.markers.some(
    (m) => m.name === '合成机场自定义名 · Synthetic Airport Label',
  ),
);
const output = resolve(root, 'data/generated/visited-map-markers');
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'ui-fixture.snapshot.json'),
  JSON.stringify(snapshot, null, 2) + '\n',
  'utf8',
);
await writeFile(
  resolve(output, 'ui-fixture.json'),
  JSON.stringify(
    {
      purpose: 'Synthetic-only browser fixture; never combine with personal records.',
      catalogVersion: catalog.version,
      snapshotFile: 'ui-fixture.snapshot.json',
      cases,
      expectedByScope,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(
  JSON.stringify(
    {
      output,
      syntheticVisitRecords: Object.keys(snapshot.entries).length,
      cases: cases.map((c) => ({ label: c.label, recordId: c.recordId })),
      counts: Object.fromEntries(
        Object.entries(expectedByScope).map(([scope, value]) => [scope, value.counts]),
      ),
    },
    null,
    2,
  ),
);
