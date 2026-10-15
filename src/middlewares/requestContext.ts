import { randomUUID } from 'crypto';
import { RequestHandler } from 'express';
import { logger } from '../utils/logger';

/** Correlation id + one structured access-log line per request. Logs path only (no query string, no body, no headers). */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info('http_request', {
      requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - start) / 1_000_000n), userId: req.user?.id, role: req.user?.role,
    });
  });
  next();
};
