import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from '../src/modules/auth/auth.js';
import { databasePool } from '../src/database/connection.js';

try {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  const sql = await readFile(
    new URL('../../../infra/sql/0001_foundation.sql', import.meta.url),
    'utf8',
  );
  await databasePool.query(sql);
  console.log('数据库结构已初始化。');
} finally {
  await databasePool.end();
}
