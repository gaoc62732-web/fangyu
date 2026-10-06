import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const output = new URL('../apps/web/dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', output), 'utf8'));
const findChunk = (source) => {
  const match = Object.entries(manifest).find(
    ([key, chunk]) => (chunk.src || key).endsWith(source) || chunk.name === source,
  );
  assert(match, `Missing built module: ${source}`);
  return match[0];
};
function staticDependencies(entry, result = new Set()) {
  if (result.has(entry)) return result;
  assert(manifest[entry], `Missing manifest dependency: ${entry}`);
  result.add(entry);
  for (const dependency of manifest[entry].imports || []) staticDependencies(dependency, result);
  return result;
}
const catalog = findChunk('src/pages/CatalogPage.vue');
const imports = findChunk('src/pages/ImportsPage.vue');
const runtime = findChunk('src/features/maps/tile-runtime.ts');
const workbook = findChunk('exceljs.min');
const main = Object.keys(manifest).find((key) => manifest[key].isEntry);
assert(main, 'Missing application entry');
for (const entry of [main, catalog, imports]) {
  const eager = staticDependencies(entry);
  assert(!eager.has(runtime), `${entry} eagerly loads the map engine`);
  assert(!eager.has(workbook), `${entry} eagerly loads ExcelJS`);
}
assert(manifest[runtime].isDynamicEntry, 'Map engine must remain dynamically loaded');
assert(manifest[workbook].isDynamicEntry, 'ExcelJS must remain dynamically loaded');
const bytes = (entries) =>
  [...entries].reduce(
    (total, key) => total + readFileSync(new URL(manifest[key].file, output)).length,
    0,
  );
const size = (key) => {
  const data = readFileSync(new URL(manifest[key].file, output));
  return { bytes: data.length, gzip: gzipSync(data).length };
};
console.log(
  'Bundle loading passed: catalog/import pages keep MapLibre and ExcelJS behind dynamic imports.',
);
console.log(
  JSON.stringify(
    {
      mainStaticJavaScriptBytes: bytes(staticDependencies(main)),
      catalogStaticJavaScriptBytes: bytes(staticDependencies(catalog)),
      importsStaticJavaScriptBytes: bytes(staticDependencies(imports)),
      mapEngine: size(runtime),
      excel: size(workbook),
    },
    null,
    2,
  ),
);
