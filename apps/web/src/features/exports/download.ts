export function download(
  data: Blob | string,
  name: string,
  type = 'application/json;charset=utf-8',
) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function exportJson(snapshot: unknown, name = '方舆旅行记录.json') {
  download(JSON.stringify(snapshot, null, 2), name);
}
export function exportCsv(rows: unknown[][], name: string) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? '');
          if (/^[=+@-]/.test(text)) text = "'" + text;
          return '"' + text.replace(/"/g, '""') + '"';
        })
        .join(','),
    )
    .join('\r\n');
  download('\ufeff' + csv, name, 'text/csv;charset=utf-8');
}
