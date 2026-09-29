import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
}

const catalog = await readJson('data/catalog/catalog.json');
const manifest = await readJson('data/catalog/manifest.json');
const references = await readJson('data/references/ccid-2025.json');
const regions = new Map(catalog.regions.map((region) => [region.id, region]));
const entries = new Map(catalog.entries.map((entry) => [entry.id, entry]));
const categoryIds = new Set(catalog.categories.map((category) => category.id));
const failures = [];

if (regions.size !== catalog.regions.length) failures.push('地区 ID 重复');
if (entries.size !== catalog.entries.length) failures.push('项目 ID 重复');
if (categoryIds.size !== catalog.categories.length) failures.push('类别 ID 重复');
if (
  manifest.version !== catalog.version ||
  manifest.regions !== regions.size ||
  manifest.entries !== entries.size
) {
  failures.push('manifest 与目录版本或数量不一致');
}

function requireRegions(ids, owner) {
  for (const id of ids || []) {
    if (!regions.has(id)) failures.push(owner + '：未知地区 ' + id);
  }
}

for (const region of regions.values()) {
  if (region.parentId) requireRegions([region.parentId], region.name);
  const visited = new Set([region.id]);
  let parent = regions.get(region.parentId);
  while (parent) {
    if (visited.has(parent.id)) {
      failures.push('地区父级循环：' + region.name);
      break;
    }
    visited.add(parent.id);
    parent = regions.get(parent.parentId);
  }
}

for (const entry of entries.values()) {
  const canonical = entries.get(entry.recordId);
  if (!canonical || canonical.recordId !== canonical.id) {
    failures.push('记录主体无效：' + entry.name);
  }
  if (!categoryIds.has(entry.categoryId)) failures.push('类别无效：' + entry.name);
  if (!entry.regionIds.length) failures.push('缺少所属地区：' + entry.name);
  requireRegions(entry.regionIds, entry.name);
  requireRegions(Object.values(entry.topicRegions || {}).flat(), entry.name);
  if (entry.linkedRegionId) requireRegions([entry.linkedRegionId], entry.name);
  if (new Set(entry.subitems.map((item) => item.id)).size !== entry.subitems.length) {
    failures.push('组成项目 ID 重复：' + entry.name);
  }
  if (
    entry.coordinates &&
    (entry.coordinates.length !== 2 ||
      !entry.coordinates.every(Number.isFinite) ||
      Math.abs(entry.coordinates[0]) > 180 ||
      Math.abs(entry.coordinates[1]) > 90)
  ) {
    failures.push('坐标无效：' + entry.name);
  }
}

function conditionReferences(condition) {
  requireRegions(condition.regionIds, '成就条件');
  for (const id of condition.entryIds || []) {
    if (!entries.has(id)) failures.push('成就项目引用无效：' + id);
  }
  for (const child of condition.conditions || []) conditionReferences(child);
}

requireRegions(catalog.achievements.quantityRegionIds, '数量成就');
for (const definition of catalog.achievements.definitions) {
  for (const target of definition.targets) {
    requireRegions(target.regionIds, definition.title);
    conditionReferences(target.condition);
  }
}

for (const scope of ['china', 'world', 'japan', 'korea']) {
  const geometry = await readJson('data/catalog/' + scope + '.geo.json');
  if (new Set(geometry.map((feature) => feature.id)).size !== geometry.length) {
    failures.push(scope + '：几何 ID 重复');
  }
  for (const feature of geometry) {
    if (!['province', 'city', 'county', 'country', 'border'].includes(feature.level)) {
      failures.push(scope + '：未知几何层级 ' + feature.level);
    }
    if (feature.regionId) requireRegions([feature.regionId], '地图 ' + scope);
  }
}

for (const group of [references.county, references.district]) {
  if (group.length !== 100 || new Set(group.map((row) => row.id)).size !== 100) {
    failures.push('2025 百强榜数量或去重失败');
  }
  for (const row of group) {
    const region = regions.get(row.id);
    if (!region || region.code !== row.code || region.name !== row.name) {
      failures.push('2025 百强榜映射失效：' + row.name);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('目录、共享记录、成就、四类地图及固定榜单的引用检查通过。');
