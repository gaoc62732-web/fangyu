import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const root = fileURLToPath(new URL('../', import.meta.url));
const html = execFileSync('git', ['show', '3decac6:地图/方舆旅游手册地图_空白审核版.html'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 100 * 1024 * 1024,
});
const names = [
  'ACH_STEPS',
  'ACH_NAMES',
  'ACH_SHORT',
  'ACH_REGIONS',
  'ACH_REGION_COLORS',
  'ACH_REGION_STYLES',
  'WORLD_COLOR',
  'WORLD_SECTIONS',
];
const metadata = { source: '3decac6', version: '0.5.0' };
for (const name of names) {
  const match = html.match(new RegExp('const ' + name + '=([\\s\\S]*?);'));
  if (!match) throw Error('Missing reference metadata: ' + name);
  metadata[name] = vm.runInNewContext('(' + match[1] + ')', Object.create(null), { timeout: 100 });
}
const font = html.match(
  /@font-face\{font-family:FangyuSeal;src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/,
);
if (!font) throw Error('Reference font missing');
await fs.mkdir(path.join(root, 'apps/web/assets'), { recursive: true });
await fs.writeFile(
  path.join(root, 'apps/web/assets/fangyu-seal.woff2'),
  Buffer.from(font[1], 'base64'),
);
await fs.writeFile(
  path.join(root, 'apps/web/src/features/achievements/legacy.json'),
  JSON.stringify(metadata, null, 2) + '\n',
);
console.log('Extracted original achievement presentation and embedded seal font.');
