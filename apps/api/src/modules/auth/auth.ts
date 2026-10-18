import { betterAuth } from 'better-auth';
import { databasePool } from '../../database/connection.js';

export function configuredWebOrigins() {
  const configured = process.env.WEB_ORIGIN || 'http://localhost:5173';
  const origins = new Set([configured]);
  try {
    const url = new URL(configured);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
        const alias = new URL(url.toString());
        alias.hostname = hostname;
        origins.add(alias.origin);
      }
    }
  } catch {
    // An invalid origin is rejected by the request guard and Better Auth configuration.
  }
  return [...origins];
}

export function createAuth(allowSignup = false) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw Error('BETTER_AUTH_SECRET 必须至少为 32 个字符。');
  return betterAuth({
    database: databasePool,
    secret,
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    basePath: '/api/v1/auth',
    trustedOrigins: configuredWebOrigins(),
    emailAndPassword: { enabled: true, disableSignUp: !allowSignup, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  });
}

export const auth = createAuth();
