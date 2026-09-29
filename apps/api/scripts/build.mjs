import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(manifest.dependencies).filter((name) => !name.startsWith('@fangyu/'));

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: true,
  tsconfig: 'tsconfig.json',
});
