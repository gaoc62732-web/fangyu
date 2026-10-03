/** Bounded existing-source audit. Never changes catalogue identities, coordinates or visit records. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalog, CatalogEntry } from '../packages/contracts/src/index.js';
import type { VerifiedVisitedMapAssociation } from '../packages/domain/src/visited-map-markers.js';

const root = resolve(import.meta.dirname, '..');
const bytes = await readFile(resolve(root, 'data/catalog/catalog.json'), 'utf8');
const catalog: Catalog = JSON.parse(bytes);
const byCode = new Map<string, CatalogEntry[]>();
for (const entry of catalog.entries.filter(
  (e) => e.scope === 'world' && e.categoryId === 'airport',
)) {
  if (!entry.code) continue;
  byCode.set(entry.code, [...(byCode.get(entry.code) || []), entry]);
}
// Read against every source/target pair in this batch: reuse or relocation cannot be resolved by IATA alone.
const holds = new Map([
  ['HET呼和浩特白塔', 'HET 存在白塔／盛乐迁场与代码复用问题；本批不凭现有旧目标名称判定历史设施。'],
  [
    'LYG连云港白塔埠',
    '原条目白塔埠与目标 Huaguoshan（花果山）明确不同设施；不得随 IATA 迁场移动旧记录。',
  ],
  ['TAO青岛流亭', '原条目流亭与目标 Jiaodong（胶东）明确不同设施。'],
  ['JNG济宁曲阜', '原条目曲阜与目标 Da’an（大安）明确不同设施。'],
  ['SHS沙市', '原条目仅称沙市，同批另有荆州沙市；不能由 SHS 推定旧设施与新场相同。'],
  ['ZHA湛江', '原条目仅称湛江，同批另有湛江吴川；可能涉及旧场与迁场，暂不绑定。'],
  ['DAX达州金娅', 'DAX 目标为旧 Dachuan；本批 DZH 才对应 Jinya，原码与场名冲突。'],
  ['ZAT昭通', '原条目只称昭通，目标已为 Zhaoyang；迁场前后身份无法仅由原码区分。'],
  ['JIU九江庐山（停航扩建）', '原条目明确停航扩建，暂不将当前目标位置作为已核历史位置。'],
]);
const associations: VerifiedVisitedMapAssociation[] = [];
const deferred: Record<string, unknown>[] = [];
const retained: string[] = [];
const audit: Record<string, unknown>[] = [];
for (const entry of catalog.entries.filter(
  (e) => e.scope === 'china' && e.categoryId === 'airport',
)) {
  if (entry.coordinates) {
    retained.push(entry.id);
    continue;
  }
  const code = /^([A-Z]{3})(?=[^A-Z]|$)/.exec(entry.name)?.[1];
  const matches = code ? byCode.get(code) || [] : [];
  const target = matches.length === 1 ? matches[0] : undefined;
  let reason = !code
    ? '原始名称没有显式 IATA 前缀'
    : matches.length === 0
      ? '现有世界机场目录没有该 IATA 代码'
      : matches.length !== 1
        ? 'IATA 对应多个目标，无法唯一定位'
        : target?.countryCode !== 'CHN'
          ? '本批限定中国大陆 CHN 目标；HKG/MAC 不自动纳入此关联批次'
          : holds.get(entry.name);
  if (
    !reason &&
    (!target?.coordinates ||
      target.coordinateReferenceOnly ||
      target.ordinaryPointEligible === false)
  )
    reason = '目标缺少可用的机场场所坐标';
  if (!reason) {
    try {
      const url = new URL(target!.source || '');
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'ourairports.com' ||
        !/^\/airports\/[^/]+\/?$/.test(url.pathname)
      )
        reason = '既有目标无法确认 OurAirports 来源';
    } catch {
      reason = '既有目标来源 URL 无效';
    }
  }
  if (!reason && /无民航|停航|废弃|旧机场|已关闭|迁场|迁建/.test(entry.name))
    reason = '原始标签包含历史运营/迁移限制，需单独核定';
  const pair = {
    entryId: entry.id,
    recordId: entry.recordId,
    originalName: entry.name,
    iata: code || null,
    targetEntryId: target?.id || null,
    targetOriginalName: target?.name || null,
    targetCountryCode: target?.countryCode || null,
    targetSourceUrl: target?.source || null,
    originalIcaoAvailable: false,
    targetIcaoAliases: target?.aliases.filter((a) => /^Z[A-Z]{3}$/.test(a)) || [],
  };
  if (reason) {
    deferred.push({ ...pair, reason });
    continue;
  }
  assert(target && code && target.coordinates);
  associations.push({
    entryId: entry.id,
    recordId: entry.recordId,
    targetEntryId: target.id,
    kind: 'airport',
    reviewStatus: 'verified-source-identifier',
    identity: {
      scheme: 'iata',
      value: code,
      sourceField: 'name-prefix',
      sourceUrl: target.source!,
      sourceFile: 'data/catalog/catalog.json',
    },
    basis:
      '原中国机场条目的字面 IATA 前缀与既有世界机场 code 完全一致、目标唯一且 countryCode=CHN；逐对检查名称以排除明显旧场/新场冲突。不是机场名称模糊匹配；原记录未提供 ICAO，不声称双码核验。',
    note: '按原始 IATA 标识关联既有 OurAirports 场所参考位置；非官方入口或当前运营保证。沿用本条中国机场记录，未继承世界机场到访。',
  });
  audit.push({
    ...pair,
    decision: 'accepted-existing-source-location-evidence',
    coordinates: target.coordinates,
  });
}
assert.equal(
  associations.length,
  260,
  'This reviewed batch requires re-review if its source identities change',
);
assert.equal(deferred.length, 36);
assert.equal(retained.length, 17);
assert.equal(new Set(associations.map((r) => r.entryId)).size, associations.length);
const output = {
  schemaVersion: 1,
  checkedAt: '2026-10-03',
  catalogVersion: catalog.version,
  catalogSha256: createHash('sha256').update(bytes).digest('hex'),
  purpose:
    'Map-location evidence only; do not merge IDs, alter catalogue entries or inherit visits.',
  sources: [
    {
      url: 'https://ourairports.com/data/',
      license: 'Public Domain',
      note: 'Existing catalogue source, not newly geocoded coordinates.',
    },
  ],
  summary: {
    chinaAirportRecords: 313,
    retainedExistingCoordinates: 17,
    acceptedLocationAssociations: 260,
    deferred: 36,
    availableWithApprovedAssociations: 277,
  },
  associations,
  audit,
  deferred,
  retainedExistingCoordinateEntryIds: retained,
  limitations: [
    'IATA is not a timeless physical-site identifier; identified relocation/reuse/closure conflicts are withheld.',
    'Source China labels expose IATA but no ICAO; target ICAO aliases are recorded for provenance, not claimed as an independent original-code match.',
    'Multiple China catalogue records for one airport keep separate original record IDs and visits.',
    'This bounded existing-source review does not guarantee current operation, entrance accuracy or historical airport completeness.',
  ],
};
const path = resolve(root, 'data/extensions/research/china-airport-map-associations.json');
await mkdir(resolve(root, 'data/extensions/research'), { recursive: true });
const contents = JSON.stringify(output, null, 2) + '\n';
await writeFile(path, contents, 'utf8');
console.log(
  JSON.stringify(
    { path, ...output.summary, sha256: createHash('sha256').update(contents).digest('hex') },
    null,
    2,
  ),
);
