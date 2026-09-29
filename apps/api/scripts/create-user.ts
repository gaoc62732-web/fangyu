import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createAuth } from '../src/modules/auth/auth.js';
import { databasePool } from '../src/database/connection.js';

const prompt = createInterface({ input: stdin, output: stdout });
try {
  const email = process.env.FANGYU_ACCOUNT_EMAIL || (await prompt.question('账号邮箱：'));
  const password = process.env.FANGYU_ACCOUNT_PASSWORD;
  if (!password) throw Error('请在 FANGYU_ACCOUNT_PASSWORD 环境变量中提供至少 12 位初始密码。');
  const name = await prompt.question('显示名称：');
  await createAuth(true).api.signUpEmail({ body: { email, password, name } });
  console.log('账号已创建。');
} finally {
  prompt.close();
  await databasePool.end();
}
