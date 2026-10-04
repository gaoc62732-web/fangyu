// npm convenience entry: all networking is performed by the Python script.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const venv = path.join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const python = process.env.FANGYU_PYTHON || (existsSync(venv) ? venv : 'python');
const result = spawnSync(
  python,
  [path.join(root, 'scripts/fetch-osm-china-boundaries.py'), ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
if (result.error)
  console.error(
    'Python unavailable. Set FANGYU_PYTHON or create .venv and install scripts/requirements-osm.txt.',
  );
process.exitCode = result.status ?? 1;
