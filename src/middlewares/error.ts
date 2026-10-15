import { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, Errors } from '../utils/errors';
import { logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (req, _res, next) => next(Errors.notFound(`Route ${req.method} ${req.path} not found`));

/**
 * Single place where errors become responses:
 *   { success: false, message, error: { code, details? }, requestId }
 * Only AppError / validation messages (written by us) are echoed; everything unexpected becomes a generic 500
 * and is logged through the redacting logger (never the raw driver message, which can contain field values).
 */
export const errorHandler: ErrorRequestHandler = (err: any, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400; code = 'VALIDATION_ERROR'; message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })); // messages are schema-authored, never echo input
  } else if (err?.code === 11000) {
    status = 409; code = 'DUPLICATE'; message = 'Resource already exists';
  } else if (err?.name === 'CastError' || err?.name === 'ValidationError') {
    status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid data';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_JSON'; message = 'Malformed JSON body';
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Payload too large';
  }
  if (status >= 500) logger.error('unhandled_error', { requestId: req.id, path: req.originalUrl.split('?')[0], error: err });
  res.status(status).json({ success: false, message, error: { code, ...(details ? { details } : {}) }, requestId: req.id });
};
