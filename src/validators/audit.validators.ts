import { z } from 'zod';
import { dateStr, objectId, pagination } from './common';

export const auditQuery = z.object({
  ...pagination,
  action: z.string().trim().max(60).regex(/^[A-Z_]+$/).optional(),
  userId: objectId.optional(),
  entity: z.string().trim().max(40).regex(/^[A-Za-z]+$/).optional(),
  entityId: z.string().trim().max(40).regex(/^[A-Za-z0-9-]+$/).optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
