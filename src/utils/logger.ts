import { env, isProd, isTest } from '../config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Anything that could carry credentials or patient/medical data is redacted by KEY name.
const REDACT = /pass|token|secret|hash|authorization|cookie|mobile|phone|email|birth|dob|name|notes|purpose|reason|gender|csrf/i;
const UNSAFE_MESSAGE = /Mongo|Validation|Cast/; // driver/mongoose messages can echo the offending VALUES

export function safeError(e: any) {
  const unsafe = UNSAFE_MESSAGE.test(String(e?.name)) || e?.code === 11000;
  return {
    name: e?.name, code: e?.code, codeName: e?.codeName,
    ...(unsafe ? {} : { message: String(e?.message ?? '').slice(0, 300) }),
    ...(isProd ? {} : { stack: e?.stack }),
  };
}

function redact(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? v.slice(0, 300) : v;
  if (v instanceof Error) return safeError(v);
  if (depth > 3) return '[truncated]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, REDACT.test(k) ? '[REDACTED]' : redact(val, depth + 1)]));
}

function log(level: Level, msg: string, ctx?: unknown) {
  if (isTest || RANK[level] < RANK[env.LOG_LEVEL]) return;
  const fields = ctx instanceof Error ? { error: safeError(ctx) } : (redact(ctx) as object | undefined);
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

/** Structured JSON logs. Never pass request bodies; sensitive keys are redacted defensively anyway. */
export const logger = {
  debug: (m: string, c?: unknown) => log('debug', m, c),
  info: (m: string, c?: unknown) => log('info', m, c),
  warn: (m: string, c?: unknown) => log('warn', m, c),
  error: (m: string, c?: unknown) => log('error', m, c),
};
