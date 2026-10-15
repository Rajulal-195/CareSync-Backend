export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const Errors = {
  badRequest: (m = 'Bad request', d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d),
  unauthorized: (m = 'Unauthorized') => new AppError(401, 'UNAUTHORIZED', m),
  forbidden: (m = 'Forbidden') => new AppError(403, 'FORBIDDEN', m),
  notFound: (m = 'Not found') => new AppError(404, 'NOT_FOUND', m),
  conflict: (m = 'Conflict') => new AppError(409, 'CONFLICT', m),
  unprocessable: (m = 'Unprocessable', d?: unknown) => new AppError(422, 'UNPROCESSABLE', m, d),
};
export const isDuplicateKey = (e: any) => e?.code === 11000;
