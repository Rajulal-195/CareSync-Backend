import { z } from 'zod';
import { isValidDateString } from '../utils/time';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const dateStr = z.string().refine(isValidDateString, 'Date must be a valid YYYY-MM-DD');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm (24h)');
export const email = z.string().trim().toLowerCase().email().max(254);
// bcrypt only uses the first 72 bytes, so cap at 72.
export const password = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(72)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a digit');
export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const idParam = z.object({ id: objectId });
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
