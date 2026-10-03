import type {
  GeographicFile,
  GeographicItem,
  ImportPlan,
  ImportRow,
  VisitState,
} from '@fangyu/contracts';
import type { HandbookSession } from '@fangyu/domain';
import {
  CountySpatialIndex,
  decodeText,
  docxText,
  geographicPlan,
  namePlan,
  parseKml,
  parseOsm,
  parseOsmPbf,
  photoMetadata,
  railtrackPlan,
  workbookPlan,
} from '@fangyu/import-export';

export interface SelectedFeature {
  id: string;
  source: string;
  item: GeographicItem;
  selected: boolean;
}
export interface GeographicStage {
  baseRevision: number;
  files: GeographicFile[];
  features: SelectedFeature[];
  notes: string[];
}

const MB = 1024 * 1024;
function limit(file: File, maximum: number) {
  if (file.size > maximum * MB) throw Error(file.name + ' 超过 ' + maximum + ' MB。');
}
function assertCurrent(session: HandbookSession, revision: number) {
  if (session.revision !== revision) throw Error('解析期间记录已变化，请重新生成预览。');
}

export async function parseRecordFile(session: HandbookSession, file: File): Promise<ImportPlan> {
  const revision = session.revision;
  const lower = file.name.toLowerCase();
  let plan: ImportPlan;
  limit(file, 20);
  if (lower.endsWith('.xlsx')) {
    plan = await workbookPlan(session, await file.arrayBuffer(), file.name);
  } else if (lower.endsWith('.json')) {
    const input = JSON.parse(await file.text());
    if (input.format === 'railtracker-public-history-export') {
      plan = railtrackPlan(session, input, file.name);
    } else {
      plan = {
        title: '恢复 JSON 记录',
        baseRevision: revision,
        rows: [],
        notes: ['恢复将替换当前全部记录，确认前会自动保存备份。'],
        applied: false,
        snapshot: session.validate(input),
      };
    }
  } else {
    throw Error('请选择 JSON 或新版 XLSX 文件。');
  }
  assertCurrent(session, revision);
  return plan;
}

export async function parseNamesFile(
  session: HandbookSession,
  file: File,
  categoryId: string,
): Promise<ImportPlan> {
  const revision = session.revision;
  limit(file, 20);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = file.name.toLowerCase().endsWith('.docx') ? docxText(bytes) : decodeText(bytes);
  assertCurrent(session, revision);
  return namePlan(session, text, categoryId, file.name);
}

export async function stageGeographicFiles(
  session: HandbookSession,
  files: File[],
): Promise<GeographicStage> {
  if (files.length > 200) throw Error('一次最多选择 200 个文件。');
  if (files.reduce((total, file) => total + file.size, 0) > 200 * MB)
    throw Error('本批文件超过 200 MB，请分批。');
  const stage: GeographicStage = {
    baseRevision: session.revision,
    files: [],
    features: [],
    notes: [],
  };
  let vertexCount = 0;
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.kml')) {
      limit(file, 10);
      const parsed = parseKml(decodeText(new Uint8Array(await file.arrayBuffer())));
      vertexCount += parsed.vertices;
      if (vertexCount > 250000) throw Error('KML 批量坐标超过 250000 个。');
      stage.files.push({ fileName: file.name, ...parsed });
    } else if (name.endsWith('.osm') || name.endsWith('.pbf')) {
      limit(file, name.endsWith('.pbf') ? 180 : 40);
      const parsed = name.endsWith('.pbf')
        ? await parseOsmPbf(file)
        : parseOsm(decodeText(new Uint8Array(await file.arrayBuffer())));
      stage.features.push(
        ...parsed.features.map((item: GeographicItem): SelectedFeature => ({
          id: crypto.randomUUID(),
          source: file.name,
          item,
          selected: false,
        })),
      );
      stage.notes.push(
        file.name +
          '：' +
          parsed.features.length +
          ' 个可选要素；缺少引用 ' +
          parsed.missingRefs +
          '；不支持的关系 ' +
          parsed.unsupported,
      );
    } else {
      stage.notes.push(file.name + '：格式不支持，已跳过。');
    }
  }
  assertCurrent(session, stage.baseRevision);
  return stage;
}

export function geographicPreview(
  session: HandbookSession,
  spatial: CountySpatialIndex,
  stage: GeographicStage,
  state: VisitState,
): ImportPlan {
  assertCurrent(session, stage.baseRevision);
  const files = [...stage.files];
  for (const feature of stage.features.filter((feature) => feature.selected)) {
    files.push({
      fileName: feature.source,
      items: [feature.item],
      vertices: feature.item.vertices || 0,
      unsupported: 0,
    });
  }
  if (!files.length) throw Error('请先选择 OSM 地图要素。');
  if (files.reduce((total, file) => total + file.vertices, 0) > 250000)
    throw Error('所选坐标超过 250000 个，请缩小范围。');
  const plan = geographicPlan(session, spatial, files, state);
  plan.notes.push(...stage.notes);
  return plan;
}

export function selectedOsmKml(stage: GeographicStage): string {
  const escape = (text: string) =>
    text.replace(
      /[<>&"']/g,
      (character) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[character]!,
    );
  const parts: string[] = [];
  for (const { source, item } of stage.features.filter((feature) => feature.selected)) {
    const name = escape(source + ' · ' + item.name);
    for (const point of item.points) {
      parts.push(
        '<Placemark><name>' +
          name +
          '</name><Point><coordinates>' +
          point.join(',') +
          '</coordinates></Point></Placemark>',
      );
    }
    for (const line of item.lines) {
      parts.push(
        '<Placemark><name>' +
          name +
          '</name><LineString><coordinates>' +
          line.map((point) => point.join(',')).join(' ') +
          '</coordinates></LineString></Placemark>',
      );
    }
  }
  if (!parts.length) throw Error('请先选择 OSM 要素。');
  return (
    '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    parts.join('') +
    '</Document></kml>'
  );
}

export async function photoPlan(
  session: HandbookSession,
  spatial: CountySpatialIndex,
  files: File[],
  onProgress: (message: string) => void,
): Promise<ImportPlan> {
  if (files.length > 2000) throw Error('一次最多选择 2000 张照片。');
  const revision = session.revision;
  const rows = new Map<string, ImportRow>();
  const notes: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      limit(file, 80);
      const gps = photoMetadata(await file.arrayBuffer(), file.name);
      if (!gps) {
        notes.push(file.name + '：无内嵌 GPS');
        continue;
      }
      const ids = [...spatial.pointHits([gps.lon, gps.lat])];
      const uncertain =
        ids.length > 1 || Boolean(gps.datum && !/WGS\s*[-_]?\s*84/i.test(gps.datum));
      if (!ids.length) notes.push(file.name + '：县界外或未匹配');
      for (const id of ids) {
        const region = session.index.regions.get(id)!;
        const existing = rows.get(id);
        if (existing) {
          existing.source += '；' + file.name;
          if (uncertain) {
            existing.include = false;
            existing.result = '包含边界或坐标基准歧义';
          }
          continue;
        }
        rows.set(id, {
          id: crypto.randomUUID(),
          source: file.name,
          input: gps.time || '照片 GPS',
          kind: 'region',
          candidates: [{ id, name: region.name, path: session.index.paths.get(id) || '' }],
          choice: 0,
          include: !uncertain,
          state: 'transit',
          result: uncertain ? '边界或坐标基准待核对' : 'GPS 已匹配',
        });
      }
    } catch (cause) {
      notes.push(file.name + '：' + String(cause));
    } finally {
      onProgress('已读取照片 ' + (index + 1) + ' / ' + files.length);
    }
  }
  assertCurrent(session, revision);
  return {
    title: '照片位置',
    baseRevision: revision,
    rows: [...rows.values()],
    notes,
    applied: false,
  };
}

export function applyRows(session: HandbookSession, plan: ImportPlan): Map<string, string> {
  const results = new Map<string, string>();
  if (plan.applied) throw Error('该预览已经应用。');
  assertCurrent(session, plan.baseRevision);
  if (plan.snapshot) {
    session.replace(plan.snapshot);
    return results;
  }
  for (const row of plan.rows) {
    if (!row.include) continue;
    const candidate = row.candidates[row.choice];
    if (!candidate) throw Error('请为所选行确认一个匹配目标。');
    if (row.kind === 'region') {
      const previous = session.visitState(candidate.id);
      session.upgradeRegion(candidate.id, row.state);
      results.set(
        row.id,
        previous === session.visitState(candidate.id) ? '原状态相同或更高，已保留' : '已提升',
      );
    } else if (row.entryUpdate) {
      if (row.entryUpdate.visited) session.markEntry(candidate.id, true);
      for (const subitem of row.entryUpdate.subitemIds)
        session.markSubitem(candidate.id, subitem, true);
      session.editEntry(candidate.id, row.entryUpdate.name, row.entryUpdate.note);
      results.set(row.id, '已合并项目记录');
    } else {
      for (const entryId of candidate.entryIds || [candidate.id]) session.markEntry(entryId, true);
      results.set(row.id, '已标记');
    }
  }
  return results;
}
