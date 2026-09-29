import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw Error('缺少 DATABASE_URL。请先创建 apps/api/.env。');
export const databasePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});
