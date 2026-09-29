import type { ImportPlan, ImportRow, Region } from '@fangyu/contracts';
import { VISIT_RANK } from '@fangyu/contracts';
import type { HandbookSession } from '@fangyu/domain';
import { entryAliases, entryCandidate, normalizeName } from './names.js';

interface RouteStation {
  kind: string;
  name: string;
  region?: { province?: string; city?: string; county?: string };
}
interface Route {
  path: RouteStation[];
  fromStation: string;
  toStation: string;
  trainNumber?: string;
  travelDate?: string;
}
interface RailtrackExport {
  format: string;
  formatVersion: number;
  records: { routeSnapshot?: { routeJson?: string } }[];
}

function matchesRegion(
  session: HandbookSession,
  region: Region,
  source: RouteStation['region'],
): boolean {
  const ancestors = session.index.ancestors(region.id);
  const province = ancestors.find((item) => item.level === 0);
  const city = ancestors.find((item) => item.level === 1);
  const county = ancestors.find((item) => item.level === 2);
  return (
    (!source?.province || normalizeName(province?.name) === normalizeName(source.province)) &&
    (!source?.city || normalizeName(city?.name || province?.name) === normalizeName(source.city)) &&
    (!source?.county || normalizeName(county?.name) === normalizeName(source.county))
  );
}

export function railtrackPlan(
  session: HandbookSession,
  input: unknown,
  source: string,
): ImportPlan {
  const data = input as RailtrackExport;
  if (
    data?.format !== 'railtracker-public-history-export' ||
    ![1, 6].includes(data.formatVersion) ||
    !Array.isArray(data.records)
  ) {
    throw Error('不支持的 Railtrack 导出格式。');
  }
  if (data.records.length > 5000) throw Error('Railtrack 记录超过 5000 条，请分批处理。');
  const rows = new Map<string, ImportRow>();
  const notes: string[] = [];
  const counties = session.index.catalog.regions.filter(
    (region) => region.scope === 'china' && region.level === 2 && !region.historical,
  );
  const stations = session
    .allEntries()
    .filter((entry) => entry.scope === 'china' && entry.categoryId === 'railway-station');

  data.records.forEach((record, index) => {
    let route: Route;
    try {
      const json = record.routeSnapshot?.routeJson;
      if (!json || json.length > 3 * 1024 * 1024) throw Error('路线不存在或过大');
      route = JSON.parse(json);
      if (!Array.isArray(route.path) || route.path.length > 10000)
        throw Error('路线节点无效或过多');
    } catch (cause) {
      notes.push('第 ' + (index + 1) + ' 条已跳过：' + String(cause));
      return;
    }
    const path = route.path.filter(
      (station) => station?.kind === 'station' && typeof station.name === 'string',
    );
    for (const station of path) {
      if (!station.region?.county) continue;
      const key = 'county:' + JSON.stringify(station.region);
      if (rows.has(key)) continue;
      const matches = counties.filter((region) => matchesRegion(session, region, station.region));
      const candidates = matches.map((region) => ({
        id: region.id,
        name: region.name,
        path: session.index.paths.get(region.id) || '',
      }));
      rows.set(key, {
        id: crypto.randomUUID(),
        source,
        input: [station.region.province, station.region.city, station.region.county]
          .filter(Boolean)
          .join(' / '),
        kind: 'region',
        candidates,
        choice: candidates.length === 1 ? 0 : -1,
        include:
          candidates.length === 1 &&
          VISIT_RANK[session.visitState(candidates[0]!.id)] < VISIT_RANK.transit,
        state: 'transit',
        result: candidates.length === 1 ? '沿途县区' : '待核对',
      });
    }

    const endpoints = [
      path.find((station) => normalizeName(station.name) === normalizeName(route.fromStation)),
      [...path]
        .reverse()
        .find((station) => normalizeName(station.name) === normalizeName(route.toStation)),
    ].filter((station): station is RouteStation => Boolean(station));
    if (endpoints.length < 2)
      notes.push('第 ' + (index + 1) + ' 条起终点未完整匹配，仅列出可确认候选。');

    for (const endpoint of endpoints) {
      const key = 'station:' + endpoint.name + ':' + JSON.stringify(endpoint.region);
      if (rows.has(key)) continue;
      const name = normalizeName(endpoint.name).replace(/站$/, '');
      const matches = stations.filter(
        (entry) =>
          entryAliases(entry).includes(name) &&
          entry.regionIds.some((id) => {
            const region = session.index.regions.get(id);
            return region && matchesRegion(session, region, endpoint.region);
          }),
      );
      const candidates = matches.map((entry) => entryCandidate(session, entry));
      rows.set(key, {
        id: crypto.randomUUID(),
        source,
        input: endpoint.name,
        kind: 'entry',
        candidates,
        choice: candidates.length === 1 ? 0 : -1,
        include: candidates.length === 1,
        state: 'arrived',
        result: candidates.length === 1 ? '起终点乘降' : '待核对',
      });
    }
  });
  return {
    title: 'Railtrack 行迹',
    baseRevision: session.revision,
    rows: [...rows.values()],
    notes: ['仅记录路线列明车站所属县区；中间站不自动记为乘降。', ...notes],
    applied: false,
  };
}
