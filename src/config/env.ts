import 'dotenv/config';
import { z } from 'zod';
import { isValidTimezone, parseDuration } from '../utils/time';

const DURATION = /^\d+[smhd]$/;
const duration = (def: string) => z.string().regex(DURATION, 'Use a number plus s, m, h or d (e.g. 15m, 7d)').default(def);
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required').regex(/^mongodb(\+srv)?:\/\//, 'Must start with mongodb:// or mongodb+srv://'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET is required (>= 32 chars)'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET is required (>= 32 chars)'),
    JWT_ACCESS_EXPIRES_IN: duration('15m'),
    JWT_REFRESH_EXPIRES_IN: duration('7d'),
    FRONTEND_URL: z.string().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default(''), // optional EXTRA allowed origins, comma separated
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300), // per IP per minute
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10), // per IP per 15 min
    REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30), // per IP per 15 min
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    APP_TIMEZONE: z.string().default('UTC'), // "today" for dashboards and seed data
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DB_CONNECT_RETRIES: z.coerce.number().int().min(1).max(20).default(5),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
    // seed script only
    SEED_ADMIN_NAME: z.string().default('Super Admin'),
    SEED_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    SEED_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12, 'SEED_ADMIN_PASSWORD must be >= 12 chars').optional()),
    SEED_STAFF_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12, 'SEED_STAFF_PASSWORD must be >= 12 chars').optional()),
    SEED_SAMPLE_DATA: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  })
  .superRefine((e, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    for (const o of [e.FRONTEND_URL, ...e.CORS_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean)]) {
      let ok = false;
      try { const u = new URL(o); ok = u.origin === o && ['http:', 'https:'].includes(u.protocol); } catch { /* invalid */ }
      if (!ok) add('FRONTEND_URL', `Invalid origin "${o}": use scheme://host[:port] with no wildcard, path or trailing slash`);
    }
    if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) add('JWT_REFRESH_SECRET', 'Must differ from JWT_ACCESS_SECRET');
    const access = parseDuration(e.JWT_ACCESS_EXPIRES_IN);
    const refresh = parseDuration(e.JWT_REFRESH_EXPIRES_IN);
    if (access > 86_400) add('JWT_ACCESS_EXPIRES_IN', 'Access tokens must live at most 1 day (use refresh tokens for longer sessions)');
    if (refresh <= access) add('JWT_REFRESH_EXPIRES_IN', 'Must be longer than JWT_ACCESS_EXPIRES_IN');
    if (e.NODE_ENV === 'production' && (/change-?me/i.test(e.JWT_ACCESS_SECRET) || /change-?me/i.test(e.JWT_REFRESH_SECRET)))
      add('JWT_ACCESS_SECRET', 'Placeholder secrets are not allowed in production');
    if (!isValidTimezone(e.APP_TIMEZONE)) add('APP_TIMEZONE', 'Invalid IANA timezone');
    if (Boolean(e.SEED_ADMIN_EMAIL) !== Boolean(e.SEED_ADMIN_PASSWORD)) add('SEED_ADMIN_EMAIL', 'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD together');
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail safely: print WHICH variables are wrong and why (never their values), then refuse to start.
  const lines = Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => `  - ${k}: ${(v ?? []).join('; ')}`);
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${lines.join('\n')}\nCopy backend/.env.example to backend/.env and fill in the required values.`);
  throw new Error('Invalid environment configuration');
}

export const env = {
  ...parsed.data,
  ACCESS_TTL_SECONDS: parseDuration(parsed.data.JWT_ACCESS_EXPIRES_IN),
  REFRESH_TTL_SECONDS: parseDuration(parsed.data.JWT_REFRESH_EXPIRES_IN),
};
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const corsOrigins = [...new Set([env.FRONTEND_URL, ...env.CORS_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean)])];
export const ISSUER = 'emr-api';
export const AUDIENCE = 'emr-web';
