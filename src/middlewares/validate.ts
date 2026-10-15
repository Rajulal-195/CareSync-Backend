import { RequestHandler } from 'express';
import { ZodTypeAny } from 'zod';

/** Parses (and thereby sanitises) body/query/params. Unknown body keys are rejected by .strict() schemas. */
export const validate =
  (s: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler =>
  (req, _res, next) => {
    try {
      if (s.params) req.params = s.params.parse(req.params);
      if (s.query) req.query = s.query.parse(req.query);
      if (s.body) req.body = s.body.parse(req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
