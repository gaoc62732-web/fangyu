import { betterAuth } from 'better-auth';
import { databasePool } from '../../database/connection.js';

export function createAuth(allowSignup = false) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw Error('BETTER_AUTH_SECRET 必须至少为 32 个字符。');
  return betterAuth({
    database: databasePool,
    secret,
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    basePath: '/api/v1/auth',
    trustedOrigins: [process.env.WEB_ORIGIN || 'http://localhost:5173'],
    emailAndPassword: { enabled: true, disableSignUp: !allowSignup, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  });
}

export const auth = createAuth();
