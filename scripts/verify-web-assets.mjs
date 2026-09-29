import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'apps/web/dist');
const base = new URL(process.argv[2] || 'http://127.0.0.1:5178/fangyu/');
let requests = 0;
async function get(file, expectedType) {
  const response = await fetch(new URL(file, base), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, file + ' status');
  if (expectedType) assert.match(response.headers.get('content-type') || '', expectedType, file);
  const bytes = Buffer.from(await response.arrayBuffer());
  let expected = await fs.readFile(path.join(dist, file));
  if (file.endsWith('.gz') && response.headers.get('content-encoding') === 'gzip')
    expected = gunzipSync(expected);
  assert.ok(bytes.equals(expected), file + ' must match the production artifact, not SPA fallback');
  requests++;
  return bytes;
}
const html = (await get('index.html', /html/)).toString();
assert.ok(html.includes(base.pathname + 'assets/'), 'HTML uses the deployment base');
const assets = await fs.readdir(path.join(dist, 'assets'));
for (const file of assets.filter((f) => /\.(js|css)$/.test(f)))
  await get('assets/' + file, /javascript|css/);
const css = (
  await Promise.all(
    assets
      .filter((f) => /\.css$/.test(f))
      .map((f) => fs.readFile(path.join(dist, 'assets', f), 'utf8')),
  )
).join('\n');
assert.ok(css.includes(base.pathname + 'fonts/fangyu-seal.woff2'), 'font uses deployment base');
const workers = assets.filter((f) => /worker.*\.js$/.test(f));
assert.equal(workers.length, 2, 'catalog and MapLibre workers are emitted');
const catalogManifest = JSON.parse(await get('catalog-manifest.json', /json/));
const catalogBytes = await get(catalogManifest.file);
const catalog = JSON.parse(
  (catalogBytes[0] === 0x1f ? gunzipSync(catalogBytes) : catalogBytes).toString(),
);
assert.ok(catalog.entries.length > 30000);
const mapManifest = JSON.parse(await get('map-manifest.json', /json/));
for (const scope of Object.values(mapManifest.scopes)) {
  for (const layer of scope.layers)
    await get(layer.url.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'));
}
assert.equal((await get('fonts/fangyu-seal.woff2')).subarray(0, 4).toString(), 'wOF2');
console.log(
  JSON.stringify(
    {
      base: base.href,
      requests,
      entries: catalog.entries.length,
      workers,
      result: 'production resources passed',
    },
    null,
    2,
  ),
);
