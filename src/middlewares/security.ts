import { RequestHandler } from 'express';
import { corsOrigins } from '../config/env';
import { Errors } from '../utils/errors';

/**
 * NoSQL-injection guard. Zod schemas already reject non-string/non-primitive values, this is defence in depth:
 * any key starting with `$` or containing `.` anywhere in body/query/params (e.g. `{"email":{"$gt":""}}`,
 * `?status[$ne]=x`) is refused before it can reach a query.
 */
const hasOperatorKeys = (o: unknown, depth = 0): boolean => {
  if (!o || typeof o !== 'object') return false;
  if (depth > 8) return true; // absurd nesting is never legitimate here
  return Object.entries(o).some(([k, v]) => k.startsWith('$') || k.includes('.') || hasOperatorKeys(v, depth + 1));
};
export const noSqlGuard: RequestHandler = (req, _res, next) =>
  hasOperatorKeys(req.body) || hasOperatorKeys(req.query) || hasOperatorKeys(req.params)
    ? next(Errors.badRequest('Invalid request: operator-like keys are not allowed'))
    : next();

/** Strict origin policy: a browser Origin that is neither allow-listed nor this server itself is refused outright. */
export const originGuard: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (!origin || corsOrigins.includes(origin) || origin === `${req.protocol}://${req.get('host')}`) return next();
  next(Errors.forbidden('Origin not allowed'));
};
