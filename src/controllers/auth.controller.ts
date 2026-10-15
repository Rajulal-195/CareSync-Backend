import { Request, Response } from 'express';
import { CSRF_COOKIE, REFRESH_COOKIE, clearOptions, csrfCookieOptions, refreshCookieOptions } from '../config/cookies';
import { env } from '../config/env';
import * as auth from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';
import { randomToken } from '../utils/crypto';

const ctx = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const issueCsrf = (res: Response, existing?: string) => {
  const token = existing || randomToken(24);
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
};
const body = (message: string, r: { accessToken: string; user: unknown }, csrfToken: string) => ({
  message,
  data: { accessToken: r.accessToken, tokenType: 'Bearer', expiresIn: env.ACCESS_TTL_SECONDS, csrfToken, user: r.user },
});

export const login = asyncHandler(async (req, res) => {
  const r = await auth.login(req.body.email, req.body.password, ctx(req));
  res.cookie(REFRESH_COOKIE, r.refreshToken, refreshCookieOptions()); // refresh token is NEVER in the body
  res.json(body('Login successful', r, issueCsrf(res)));
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw Errors.unauthorized('No session');
  try {
    const r = await auth.refresh(token, ctx(req));
    res.cookie(REFRESH_COOKIE, r.refreshToken, refreshCookieOptions());
    res.json(body('Token refreshed', r, issueCsrf(res, req.cookies?.[CSRF_COOKIE])));
  } catch (e) {
    res.clearCookie(REFRESH_COOKIE, clearOptions());
    throw e;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE], ctx(req));
  res.clearCookie(REFRESH_COOKIE, clearOptions());
  res.clearCookie(CSRF_COOKIE, clearOptions());
  res.json({ message: 'Logged out', data: null });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ data: await auth.getMe(req.user!.id) });
});

/** Lets a SPA on another origin obtain/refresh its CSRF token after a page reload. */
export const csrf = asyncHandler(async (req, res) => {
  res.json({ data: { csrfToken: issueCsrf(res, req.cookies?.[CSRF_COOKIE]) } });
});
