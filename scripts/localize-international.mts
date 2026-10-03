/** Apply audited display names without changing source identities or personal records. */
import assert from 'node:assert/strict';
import type { Catalog } from '../packages/contracts/src/index.js';
import { applyBilingualName } from './localize-vietnam.mjs';
type Row = Record<string, any>;
export function localizeInternational(catalog: Catalog, sources: Row[], resolutions: Row) {
  const overrides = new Map(
    (resolutions.rows || []).map((row: Row) => [`${row.kind}:${row.key}`, row]),
  );
  const names = new Map<string, Row>();
  const conflicts: Row[] = [];
  for (const source of sources) {
    assert(Array.isArray(source.rows), 'Missing international name rows');
    for (const row of source.rows as Row[]) {
      const key = `${row.kind}:${row.key}`;
      assert(
        row.key && /\p{Script=Han}/u.test(row.zh || '') && row.en?.trim(),
        `Incomplete bilingual name: ${key}`,
      );
      const previous = names.get(key);
      if (previous && (previous.zh !== row.zh || previous.en !== row.en)) {
        const selected = overrides.get(key) as Row | undefined;
        assert(
          selected,
          `Conflicting display names need an explicit resolution: ${key}: ${previous.zh} / ${row.zh}`,
        );
        conflicts.push({ key, variants: [previous.zh, row.zh], selected: selected.zh });
        names.set(key, selected);
      } else names.set(key, row);
    }
  }
  const targets: Record<string, Map<string, any>> = {
    region: new Map(catalog.regions.map((row) => [row.id, row])),
    entry: new Map(catalog.entries.map((row) => [row.id, row])),
    project: new Map((catalog.heritageProjects || []).map((row) => [row.unescoId, row])),
    club: new Map(
      (catalog.football?.competitions || []).flatMap((league) =>
        league.clubs.map((club) => [club.id, club] as const),
      ),
    ),
    competition: new Map(
      (catalog.football?.competitions || []).map((row) => [row.competitionId, row]),
    ),
  };
  const counts: Record<string, number> = {};
  for (const [identity, row] of names) {
    const target = targets[row.kind]?.get(row.key);
    assert(target, `Translated identity missing from catalogue: ${identity}`);
    target.name ||= row.original || row.en;
    // Preserve existing Chinese wording rather than replacing a valid established label.
    const keptChinese = /\p{Script=Han}/u.test(target.name) && !target.nameZh;
    applyBilingualName(target, keptChinese ? { ...row, zh: target.name } : row, identity);
    counts[row.kind] = (counts[row.kind] || 0) + 1;
  }
  // Venue lists and relation labels refer to the same catalogue entry displayed on the map.
  for (const league of catalog.football?.competitions || []) {
    for (const venue of league.venues) {
      const entry = targets.entry.get(venue.entryId);
      if (entry?.nameZh) {
        applyBilingualName(
          venue,
          {
            zh: entry.nameZh,
            en: entry.nameEn,
            original: venue.name,
            aliases: entry.aliases,
            note: entry.nameTranslationNote,
          },
          venue.id,
        );
      }
      const clubNames = league.homeGrounds
        .filter((home) => home.venueId === venue.id)
        .flatMap((home) => {
          const club = targets.club.get(home.clubId);
          return club
            ? [club.name, club.nameZh, club.nameEn, club.originalName, ...(club.aliases || [])]
            : [];
        })
        .filter(Boolean);
      if (entry) entry.aliases = [...new Set([...entry.aliases, ...clubNames])];
      venue.aliases = [...new Set([...venue.aliases, ...clubNames])];
    }
  }
  for (const venue of catalog.football?.standaloneVenues || []) {
    const entry = targets.entry.get(venue.entryId);
    if (entry?.nameZh)
      applyBilingualName(
        venue,
        {
          zh: entry.nameZh,
          en: entry.nameEn,
          original: venue.name,
          aliases: entry.aliases,
          note: entry.nameTranslationNote,
        },
        venue.id,
      );
  }
  const scopes = [
    'china',
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
  ];
  const remaining = scopes.map((scope) => ({
    scope,
    regionsWithoutChinese: catalog.regions
      .filter((r) => r.scope === scope && !/\p{Script=Han}/u.test(r.name))
      .map((r) => ({ id: r.id, name: r.name })),
    entriesWithoutChinese: catalog.entries
      .filter(
        (e) =>
          (e.scope === scope || (e.topicRegions as any)?.[scope]?.length) &&
          !/\p{Script=Han}/u.test(e.name),
      )
      .map((e) => ({ id: e.id, name: e.name, categoryId: e.categoryId })),
  }));
  return { counts, conflicts, remaining };
}
