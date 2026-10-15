import { CookieOptions } from 'express';
import { env, isProd } from './env';

export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
export const COOKIE_PATH = '/api/v1/auth';

const base = {
  secure: isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: COOKIE_PATH,
} as const;

export const refreshCookieOptions = (): CookieOptions => ({
  ...base,
  httpOnly: true,
  maxAge: env.REFRESH_TTL_SECONDS * 1000,
});
// Readable by JS on purpose (double-submit CSRF token). Carries no authority on its own.
export const csrfCookieOptions = (): CookieOptions => ({
  ...base,
  httpOnly: false,
  maxAge: env.REFRESH_TTL_SECONDS * 1000,
});
export const clearOptions = (): CookieOptions => ({ ...base });
