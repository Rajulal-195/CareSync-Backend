import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const limited = (message: string) => ({ success: false, message, error: { code: 'RATE_LIMITED' } });
const opts = (windowMs: number, limit: number, message: string) => ({
  windowMs, limit, standardHeaders: true as const, legacyHeaders: false, message: limited(message),
});

export const apiLimiter = rateLimit(opts(60 * 1000, env.API_RATE_LIMIT_MAX, 'Too many requests, slow down'));
export const loginLimiter = rateLimit(opts(15 * 60 * 1000, env.LOGIN_RATE_LIMIT_MAX, 'Too many login attempts, try again later'));
export const refreshLimiter = rateLimit(opts(15 * 60 * 1000, env.REFRESH_RATE_LIMIT_MAX, 'Too many refresh attempts, try again later'));
