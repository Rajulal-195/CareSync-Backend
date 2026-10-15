import { RequestHandler } from 'express';
import { CSRF_COOKIE } from '../config/cookies';
import { corsOrigins } from '../config/env';
import { Errors } from '../utils/errors';
import { safeEqual } from '../utils/crypto';

/**
 * CSRF defence for the cookie-authenticated endpoints (/auth/refresh, /auth/logout):
 *  1. SameSite cookie (configurable),
 *  2. Origin header, when present, must be an allowed origin,
 *  3. double-submit token: X-CSRF-Token header must equal the csrf_token cookie.
 * Everything else uses a Bearer header, which browsers never attach automatically.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !corsOrigins.includes(origin)) return next(Errors.forbidden('Origin not allowed'));
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeEqual(String(cookie), String(header))) return next(Errors.forbidden('CSRF token missing or invalid'));
  next();
};
