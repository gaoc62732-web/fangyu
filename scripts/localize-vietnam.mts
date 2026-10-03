/** Display-only bilingual names. IDs, coordinates, membership and personal records never change. */
import assert from 'node:assert/strict';
import type { Catalog } from '../packages/contracts/src/index.js';
type Row = Record<string, any>;
interface Named {
  name: string;
  nameZh?: string;
  nameEn?: string;
  nameTranslationNote?: string;
  nameTranslationStatus?: string;
  nameTranslationNeedsReview?: boolean;
  originalName?: string;
  aliases?: string[];
}
function indexed(rows: Row[], key: (row: Row) => string) {
  assert(Array.isArray(rows), 'Missing Vietnamese translation collection');
  const map = new Map<string, Row>();
  for (const row of rows) {
    const id = key(row);
    assert(id && !map.has(id), `Duplicate or missing translation identity: ${id}`);
    assert(
      typeof row.zh === 'string' && /\p{Script=Han}/u.test(row.zh),
      `Missing Chinese name: ${id}`,
    );
    assert(typeof row.en === 'string' && row.en.trim(), `Missing English name: ${id}`);
    map.set(id, row);
  }
  return map;
}
export function applyBilingualName(target: Named, translation: Row | undefined, identity: string) {
  assert(translation, `Untranslated Vietnamese display name: ${identity}`);
  const previous = target.name;
  target.originalName ||= translation.originalName || translation.original || previous;
  target.nameZh = translation.zh.trim();
  target.nameEn = translation.en.trim();
  target.nameTranslationStatus =
    translation.translationStatus ||
    translation.certainty ||
    (/暂|待核/.test(translation.uncertainty || '') ? 'provisional' : 'editorial');
  target.nameTranslationNote =
    translation.uncertainty ||
    translation.note ||
    (/medium|provisional|transliterat|pending/i.test(translation.certainty || '')
      ? '中文采用保守的语义译名；可对照原文名称。'
      : undefined);
  target.nameTranslationNeedsReview =
    /provisional|transliterat|pending|unresolved/i.test(target.nameTranslationStatus || '') ||
    /暂|待[^。]{0,24}(核|校)|尚未核实[^。]{0,16}中文/.test(target.nameTranslationNote || '');
  target.name = `${target.nameZh} · ${target.nameEn}`;
  target.aliases = [
    ...new Set(
      [
        ...(target.aliases || []),
        previous,
        target.originalName!,
        target.nameZh!,
        target.nameEn!,
        ...(translation.aliases || []),
      ].filter(Boolean),
    ),
  ].filter((name) => name !== target.name);
}
export function localizeVietnam(
  catalog: Catalog,
  geography: Row,
  nationalParents: Row,
  nationalComponents: Row,
) {
  const regionNames = indexed(geography.regions, (row) => row.key || row.code);
  const projectNames = indexed(geography.projects, (row) => row.key || row.unescoId);
  const heritageNames = indexed(geography.components, (row) => row.key || row.componentKey);
  const airportNames = indexed(geography.airports, (row) => row.key || row.code);
  const parentNames = indexed(nationalParents.parents, (row) => row.sourceId);
  const componentNames = indexed(nationalComponents.components, (row) => row.sourceId);
  const counts = {
    regions: 0,
    country: 0,
    projects: 0,
    heritageComponents: 0,
    legacyProjects: 0,
    nationalParents: 0,
    nationalComponents: 0,
    airports: 0,
  };
  for (const region of catalog.regions) {
    if (region.scope === 'vietnam') {
      applyBilingualName(region, regionNames.get(region.code), region.id);
      counts.regions++;
    } else if (region.scope === 'world' && region.code === 'VNM') {
      applyBilingualName(
        region,
        { zh: '越南', en: 'Vietnam', original: 'Việt Nam', aliases: ['Viet Nam'] },
        region.id,
      );
      counts.country++;
    }
  }
  for (const project of catalog.heritageProjects || []) {
    if (!project.countryCodes?.includes('VNM')) continue;
    applyBilingualName(project, projectNames.get(project.unescoId), project.unescoId);
    counts.projects++;
  }
  for (const entry of catalog.entries) {
    if (entry.countryCode !== 'VNM' && !entry.topicRegions?.vietnam?.length) continue;
    switch (entry.categoryId) {
      case 'vn-national-special':
        applyBilingualName(entry, parentNames.get(entry.sourceId!), entry.sourceId!);
        counts.nationalParents++;
        break;
      case 'vn-national-special-component':
        applyBilingualName(entry, componentNames.get(entry.sourceId!), entry.sourceId!);
        counts.nationalComponents++;
        break;
      case 'world-heritage-component':
        applyBilingualName(entry, heritageNames.get(entry.componentKey!), entry.componentKey!);
        counts.heritageComponents++;
        break;
      case 'world-heritage':
        applyBilingualName(
          entry,
          projectNames.get(entry.heritageProjectId || entry.code!),
          entry.id,
        );
        counts.legacyProjects++;
        break;
      case 'airport':
        applyBilingualName(entry, airportNames.get(entry.code!), entry.code!);
        counts.airports++;
        break;
    }
  }
  for (const category of catalog.categories) {
    if (category.id === 'vn-national-special')
      category.name = '越南国家特别遗迹（法定项目） · Special National Relics';
    if (category.id === 'vn-national-special-component')
      category.name = '越南国家特别遗迹组成地点 · Relic Sites';
  }
  assert.equal(counts.regions, 34);
  assert.equal(counts.projects, 9);
  assert.equal(counts.nationalParents, 149);
  assert.equal(counts.airports, 22);
  return counts;
}
