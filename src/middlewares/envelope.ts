import { RequestHandler } from 'express';

const defaultMessage = (status: number) => (status === 201 ? 'Created successfully' : 'Operation successful');

/**
 * Central success envelope for everything under /api/v1:
 *   { success: true, message, data, meta }
 * Controllers return `{ data, meta?, message? }`; this wraps it so no handler can forget the shape.
 * Bodies that already carry `success` (errors, rate-limit responses) pass through untouched.
 */
export const envelope: RequestHandler = (_req, res, next) => {
  const original = res.json.bind(res);
  res.json = ((body: any) => {
    if (body && typeof body === 'object' && 'success' in body) return original(body);
    const status = res.statusCode;
    return original({ success: status < 400, message: body?.message ?? defaultMessage(status), data: body?.data ?? null, meta: body?.meta ?? {} });
  }) as typeof res.json;
  next();
};
