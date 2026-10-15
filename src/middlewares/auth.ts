import { RequestHandler } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';
import { authenticateAccessToken } from '../services/auth.service';
import { Role } from '../models/constants';

export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const h = req.get('authorization');
  if (!h || !h.startsWith('Bearer ')) throw Errors.unauthorized('Missing bearer token');
  req.user = await authenticateAccessToken(h.slice(7));
  next();
});

/** RBAC: must run after `authenticate`. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(Errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(Errors.forbidden('Insufficient permissions'));
    next();
  };
