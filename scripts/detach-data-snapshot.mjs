// Explicit migration command: remove tracked snapshot files from the index only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const verification = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/run-data-snapshot.mjs'), 'verify'],
  { cwd: root, stdio: 'inherit' },
);
if (verification.status !== 0)
  throw Error('Snapshot verification failed; Git tracking was not changed');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'data/snapshots/current.json'), 'utf8'),
);
const tracked = spawnSync('git', ['ls-files', '-z', 'data'], { cwd: root, encoding: 'utf8' });
if (tracked.status !== 0) throw Error('Cannot read tracked data files');
const trackedPaths = new Set(tracked.stdout.split('\0').filter(Boolean));
const files = manifest.packages
  .flatMap((p) => p.files.map((f) => f.path))
  .filter((p) => trackedPaths.has(p));
for (const p of files) {
  if (!p.startsWith('data/') || p.includes('..') || !fs.existsSync(path.join(root, p)))
    throw Error('Invalid or missing local snapshot file: ' + p);
}
if (files.length) {
  const result = spawnSync('git', ['rm', '--cached', '--', ...files], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} else console.log('Snapshot data is already outside Git tracking.');
