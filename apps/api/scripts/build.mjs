import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(manifest.dependencies).filter((name) => !name.startsWith('@fangyu/'));
const entryPoint = process.argv[2] || 'src/main.ts';
const outputName = entryPoint.replace(/^src[\\/]/, '').replace(/\.ts$/, '');

await build({
  entryPoints: [entryPoint],
  outfile: `dist/${outputName}.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: true,
  tsconfig: 'tsconfig.json',
});
