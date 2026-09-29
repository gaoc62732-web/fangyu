import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 12)) {
  console.error('需要 Node.js 22.12 或更新版本，推荐 Node.js 24 LTS。');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const manager = manifest.packageManager;
const args = ['exec', '--yes', '--package', manager, '--', 'pnpm', 'install'];
if (process.argv.includes('--update-lockfile')) args.push('--no-frozen-lockfile');
else if (existsSync('pnpm-lock.yaml')) args.push('--frozen-lockfile');

console.log('正在安装方舆工作区依赖，首次安装需要网络连接…');
const result =
  process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...args], {
        cwd: root,
        stdio: 'inherit',
      })
    : spawnSync('npm', args, { cwd: root, stdio: 'inherit' });

if (result.error || result.status !== 0) {
  console.error('安装未完成。请检查网络后重新运行安装脚本。', result.error?.message || '');
  process.exit(result.status || 1);
}

// Rebuild also repairs a previous install whose dependency scripts were skipped.
const rebuilt = spawnSync(
  process.execPath,
  ['node_modules/pnpm/bin/pnpm.cjs', 'rebuild', 'esbuild'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (rebuilt.error || rebuilt.status !== 0) {
  console.error('依赖的本机组件安装失败，请重新运行安装脚本。');
  process.exit(rebuilt.status || 1);
}

for (const directory of ['apps/web', 'apps/api']) {
  const path = directory + '/.env';
  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const example = readFileSync(directory + '/.env.example', 'utf8');
  for (const line of example.split(/\r?\n/)) {
    const key = line.match(/^([A-Z_]+)=/u)?.[1];
    if (key && !new RegExp('^' + key + '=', 'm').test(content)) content += '\n' + line;
  }
  if (directory === 'apps/api') {
    content = content.replace(
      /^BETTER_AUTH_SECRET=[\t ]*\r?$/m,
      'BETTER_AUTH_SECRET=' + randomBytes(32).toString('hex'),
    );
  }
  writeFileSync(path, content.trim() + '\n', { mode: 0o600 });
}
console.log('依赖安装完成，已补齐缺失配置并保留已有配置值。');
console.log('Windows 可双击“启动前端.cmd”；其他平台运行 npm run dev:web。');
