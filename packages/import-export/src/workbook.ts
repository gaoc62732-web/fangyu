import ExcelJS from 'exceljs';
import type { ImportPlan, ImportRow } from '@fangyu/contracts';
import { VISIT_LABELS, VISIT_STATES } from '@fangyu/contracts';
import type { HandbookSession } from '@fangyu/domain';

export async function exportWorkbook(session: HandbookSession): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '方舆';
  const regions = workbook.addWorksheet('地区记录');
  regions.addRow(['地区 ID', '名称', '层级路径', '状态']);
  for (const region of session.index.catalog.regions) {
    regions.addRow([
      region.id,
      region.name,
      session.index.paths.get(region.id),
      session.visitState(region.id),
    ]);
  }
  const entries = workbook.addWorksheet('项目记录');
  entries.addRow(['项目 ID', '名称', '地区', '类别', '到访', '组成项目 ID（JSON）', '备注']);
  const snapshot = session.snapshot();
  for (const entry of session.entries()) {
    // A shared record has one editable row, even when several catalog pages show it.
    if (entry.id !== entry.recordId) continue;
    const record = snapshot.entries[entry.recordId];
    entries.addRow([
      entry.id,
      entry.name,
      entry.path,
      entry.categoryId,
      entry.checked,
      JSON.stringify(record?.subitemIds || []),
      entry.note,
    ]);
  }
  const guide = workbook.addWorksheet('说明');
  guide.addRows([
    ['方舆目录版本', session.index.catalog.version],
    ['使用方式', '保留 ID 列，修改地区状态、到访、组成项目、名称和备注后重新导入。'],
    ['状态', VISIT_STATES.map((state) => state + '=' + VISIT_LABELS[state]).join('；')],
    ['导入规则', '到访状态只提升不降低；未匹配 ID 会列入核对清单。完整备份请使用 JSON。'],
    ['共享项目', '中国、世界及日韩专题共用的项目仅导出一行，修改后同步到所有关联页面。'],
  ]);
  for (const sheet of [regions, entries]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };
    sheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 40 : 28;
    });
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function workbookPlan(
  session: HandbookSession,
  data: ArrayBuffer,
  source: string,
): Promise<ImportPlan> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const rows: ImportRow[] = [];
  const notes: string[] = [];
  const regions = workbook.getWorksheet('地区记录');
  const entries = workbook.getWorksheet('项目记录');
  const entryIndex = new Map(session.allEntries().map((entry) => [entry.id, entry]));
  if (!regions && !entries) throw Error('未找到新版“地区记录”或“项目记录”工作表。');
  const stateNames = Object.fromEntries(
    Object.entries(VISIT_LABELS).map(([key, value]) => [value, key]),
  );
  regions?.eachRow((row, number) => {
    if (number === 1) return;
    const id = row.getCell(1).text.trim();
    const region = session.index.regions.get(id);
    const input = row.getCell(4).text.trim();
    const state = (stateNames[input] || input) as (typeof VISIT_STATES)[number];
    if (!region || !VISIT_STATES.includes(state)) {
      notes.push('地区记录第 ' + number + ' 行：未知 ID 或状态');
      return;
    }
    rows.push({
      id: crypto.randomUUID(),
      source,
      input: region.name,
      kind: 'region',
      candidates: [{ id, name: region.name, path: session.index.paths.get(id) || '' }],
      choice: 0,
      include: true,
      state,
      result: '已匹配',
    });
  });
  entries?.eachRow((row, number) => {
    if (number === 1) return;
    const id = row.getCell(1).text.trim();
    const entry = entryIndex.get(id);
    if (!entry) {
      notes.push('项目记录第 ' + number + ' 行：未知项目 ID');
      return;
    }
    const canonicalEntry = entryIndex.get(entry.recordId)!;
    let subitemIds: string[];
    try {
      const value: unknown = JSON.parse(row.getCell(6).text || '[]');
      if (
        !Array.isArray(value) ||
        value.some(
          (item) =>
            typeof item !== 'string' ||
            !canonicalEntry.subitems.some((subitem) => subitem.id === item),
        )
      )
        throw Error('组成项目不存在');
      subitemIds = value;
    } catch {
      notes.push('项目记录第 ' + number + ' 行：组成项目 ID 无效');
      return;
    }
    const visited = ['true', '1', '是', '√'].includes(row.getCell(5).text.toLowerCase());
    rows.push({
      id: crypto.randomUUID(),
      source,
      input: entry.name,
      kind: 'entry',
      candidates: [{ id, name: entry.name, path: session.view(entry).path }],
      choice: 0,
      include:
        visited ||
        subitemIds.length > 0 ||
        row.getCell(2).text !== session.view(entry).name ||
        row.getCell(7).text !== session.view(entry).note,
      state: 'arrived',
      result: '已匹配',
      entryUpdate: {
        visited,
        subitemIds,
        name: row.getCell(2).text || entry.name,
        note: row.getCell(7).text,
      },
    });
  });
  return { title: 'Excel 记录', baseRevision: session.revision, rows, notes, applied: false };
}
