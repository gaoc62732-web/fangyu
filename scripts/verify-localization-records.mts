import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { CatalogIndex } from '../packages/catalog/src/index.js';
import { emptySnapshot } from '../packages/contracts/src/index.js';
import { HandbookSession } from '../packages/domain/src/session.js';
import {
  assertAdditiveCatalogCompatibility,
  validateHeritageProjects,
} from '../packages/domain/src/heritage.js';
const previous = JSON.parse(
  execFileSync('git', ['show', '279fd90:data/catalog/catalog.json'], {
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
  }),
);
const current = JSON.parse(readFileSync('data/catalog/catalog.json', 'utf8'));
assert.equal(current.entries.length, previous.entries.length);
assertAdditiveCatalogCompatibility(previous, current);
validateHeritageProjects(current, current.heritageProjects);
const byId = new Map(current.entries.map((entry: any) => [entry.id, entry]));
let changedNames = 0;
for (const old of previous.entries) {
  const next: any = byId.get(old.id);
  for (const field of [
    'recordId',
    'coordinates',
    'regionIds',
    'topicRegions',
    'categoryId',
    'heritageProjectId',
    'heritageComponentId',
    'nationalHeritageParentId',
    'sharedUnescoComponentKey',
  ])
    assert.deepEqual(next[field], old[field], old.id + ' ' + field);
  if (next.name !== old.name) {
    changedNames++;
    assert(
      !old.name || next.aliases.includes(old.name) || next.originalName === old.name,
      'Original display name must remain searchable',
    );
  }
}
const snapshot = emptySnapshot(previous.version);
const samples = [];
for (const scope of [
  'japan',
  'korea',
  'uzbekistan',
  'vietnam',
  'germany',
  'france',
  'italy',
  'uk',
  'usa',
  'spain',
]) {
  const entry = previous.entries.find((e: any) => e.topicRegions?.[scope]?.length);
  assert(entry);
  samples.push(entry.id);
  snapshot.entries[entry.recordId] = {
    visited: true,
    subitemIds: [],
    name: 'Synthetic custom ' + scope,
    note: 'Synthetic note ' + scope,
  };
  const region = previous.regions.find((r: any) => r.scope === scope);
  snapshot.regions[region.id] = 'arrived';
}
const session = new HandbookSession(new CatalogIndex(current), snapshot);
for (const id of samples) {
  const entry: any = byId.get(id);
  const old = snapshot.entries[entry.recordId];
  assert.equal(session.view(entry).name, old.name);
  assert.equal(session.view(entry).note, old.note);
  assert(session.view(entry).visited);
}
const roundtrip = new HandbookSession(
  new CatalogIndex(current),
  JSON.parse(JSON.stringify(session.snapshot())),
);
for (const id of samples)
  assert.equal(roundtrip.view(byId.get(id) as any).note, session.view(byId.get(id) as any).note);
const result = {
  previousCommit: '279fd90',
  previousVersion: previous.version,
  currentVersion: current.version,
  retainedEntries: previous.entries.length,
  changedDisplayNames: changedNames,
  coordinatesAndMembershipsUnchanged: true,
  customNamesNotesVisitsAndRoundtrip: true,
  sampledScopes: 10,
};
writeFileSync('data/generated/localization-record-check.json', JSON.stringify(result, null, 2));
console.log(
  'PASS full catalog identity/coordinates/membership compatibility; ten-country old visits, custom names, notes and roundtrip.',
);
