// Decode the public visualization endpoint using its published page's decoder.
import fs from 'node:fs/promises';
import { unzipSync } from 'node:zlib';
const base = new URL('../data/tmp/china-boundary-review/', import.meta.url);
for (const name of (await fs.readdir(base)).filter(
  (name) => name.startsWith('tdt-') && name.endsWith('.bin'),
)) {
  const packed = unzipSync(await fs.readFile(new URL(name, base)));
  if (packed.length % 4) throw Error('Unexpected TianDiTu visualization encoding');
  const decoded = Buffer.alloc(packed.length / 4);
  for (let i = 0; i < decoded.length; i++) decoded[i] = (packed.readInt32BE(i * 4) >> 2) & 255;
  const collection = JSON.parse(decoded.toString('utf8'));
  if (collection.type !== 'FeatureCollection') throw Error('Expected a feature collection');
  await fs.writeFile(
    new URL(name.replace('.bin', '.geojson'), base),
    JSON.stringify(collection) + '\n',
  );
  console.log(JSON.stringify({ name, count: collection.features.length }));
}
