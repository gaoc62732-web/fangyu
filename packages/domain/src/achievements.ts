import type { AchievementDefinition, Condition, Region } from '@fangyu/contracts';
import type { HandbookSession } from './session.js';

export interface AchievementProgress extends AchievementDefinition {
  count: number;
  total: number;
  complete: boolean;
  lit: boolean;
  next: number | undefined;
  targets: (AchievementDefinition['targets'][number] & { visited: boolean })[];
}

export function reachedRegions(session: HandbookSession): Set<string> {
  const reached = new Set<string>();
  for (const region of session.index.catalog.regions) {
    if (!session.arrived(region.id)) continue;
    for (const ancestor of session.index.ancestors(region.id)) {
      if (!session.hasExplicitState(ancestor.id) || session.arrived(ancestor.id)) {
        reached.add(ancestor.id);
      }
    }
  }
  return reached;
}

export function achievementProgress(session: HandbookSession): AchievementProgress[] {
  const reached = reachedRegions(session);
  function evaluate(condition: Condition): boolean {
    const hits: boolean[] = [];
    for (const regionId of condition.regionIds || []) {
      hits.push(condition.inferAncestors ? reached.has(regionId) : session.arrived(regionId));
    }
    for (const entryId of condition.entryIds || []) {
      const entry = session.view(session.entry(entryId));
      hits.push(condition.fullMark ? entry.checked : entry.visited);
    }
    for (const child of condition.conditions || []) hits.push(evaluate(child));
    if (condition.mode === 'all') return hits.length > 0 && hits.every(Boolean);
    if (condition.mode === 'minimum')
      return hits.filter(Boolean).length >= (condition.minimum || 1);
    return hits.some(Boolean);
  }

  const definitions = [
    ...session.index.catalog.achievements.definitions,
    ...elementAchievements(session),
  ];
  return definitions.map((definition) => {
    const targets = definition.targets.map((target) => ({
      ...target,
      visited: evaluate(target.condition),
    }));
    const count = targets.filter((target) => target.visited).length;
    const blocked = definition.pending.length > 0;
    const required = definition.need ?? targets.length;
    const highest = definition.steps?.at(-1) ?? required;
    const complete =
      !blocked && definition.catalogComplete !== false && highest > 0 && count >= highest;
    return {
      ...definition,
      targets,
      count,
      total: targets.length,
      complete,
      lit: !blocked && (definition.steps?.length ? count >= definition.steps[0]! : complete),
      next: definition.steps?.find((step) => step > count),
    };
  });
}

function elementAchievements(session: HandbookSession): AchievementDefinition[] {
  const definitions: [string, string, number[]][] = [
    ['airport', '机场行旅', [1, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500]],
    ['railway-station', '铁路行旅', [1, 10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500]],
    ['first-class-museum', '一级博物馆', [1, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400]],
    ['cultural-monument', '国保寻踪', [1, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000]],
  ];
  return definitions.map(([categoryId, title, steps]) => {
    const groups = new Map<string, AchievementDefinition['targets'][number]>();
    for (const entry of session.entries('china')) {
      if (entry.categoryId !== categoryId) continue;
      const region = session.index.regions.get(entry.regionIds[0] || '');
      if (!region || region.historical) continue;
      const provinceId = session.index.ancestors(region.id)[0]?.id || region.id;
      const scope = categoryId === 'cultural-monument' ? 'national' : provinceId;
      const key = scope + ':' + entry.name.replace(/\s/g, '');
      const group = groups.get(key) || {
        label: entry.name,
        regionIds: [],
        condition: { mode: 'any' as const, entryIds: [] },
      };
      group.regionIds.push(region.id);
      group.condition.entryIds!.push(entry.id);
      groups.set(key, group);
    }
    return {
      id: 'elements-' + categoryId,
      title,
      section: 'elements',
      steps,
      note: '仅统计中国目录中项目自身的到访；同省同名项目合并，国保按总项名称全国合并。任一组成项目有标记即计该总项。',
      sources: [],
      pending: [],
      targets: [...groups.values()],
    };
  });
}

export function quantityProgress(session: HandbookSession) {
  const reached = reachedRegions(session);
  const count = session.index.catalog.achievements.quantityRegionIds.filter((id) =>
    reached.has(id),
  ).length;
  const steps = [
    10, 20, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 900, 1000, 1200, 1500, 2000, 2500,
  ];
  return {
    count,
    level: steps.filter((step) => step <= count).at(-1) || 0,
    next: steps.find((step) => step > count),
  };
}

export function maofenProgress(session: HandbookSession) {
  const reached = reachedRegions(session);
  const active = session.index.catalog.regions.filter(
    (region) => region.scope === 'china' && !region.historical,
  );
  const eligible = (region: Region) => {
    if (region.level === 0) return true;
    const root = session.index.ancestors(region.id)[0];
    if (['710000', '810000', '820000'].includes(root?.code || '')) return false;
    return region.level === 1 || (region.level === 2 && /^\d{6}$/.test(region.code));
  };
  const groups = active
    .filter((region) => region.level === 0)
    .map((province) => {
      const counts = [0, 0, 0];
      const totals = [0, 0, 0];
      for (const region of active) {
        if (!eligible(region) || !session.index.belongsTo(region.id, province.id)) continue;
        totals[region.level] = (totals[region.level] || 0) + 1;
        if (reached.has(region.id)) counts[region.level] = (counts[region.level] || 0) + 1;
      }
      return { province, counts, totals, score: counts[0]! + counts[1]! * 0.2 + counts[2]! * 0.05 };
    });
  const counts = [0, 1, 2].map((level) =>
    groups.reduce((total, group) => total + group.counts[level]!, 0),
  );
  const totals = [0, 1, 2].map((level) =>
    groups.reduce((total, group) => total + group.totals[level]!, 0),
  );
  return {
    groups,
    counts,
    totals,
    score: counts[0]! + counts[1]! * 0.2 + counts[2]! * 0.05,
    maximum: totals[0]! + totals[1]! * 0.2 + totals[2]! * 0.05,
  };
}
